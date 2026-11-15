"""Candidate overlap audit. Overlap proposes inspection; it never proves an identity."""
import argparse,json
from pathlib import Path
import cv2,numpy as np
P=Path(__file__).resolve().parent
D=P.parent/'data'
px=json.load(open(D/'tracks_px_clean.json'));world=json.load(open(D/'tracks_world.json'))
M={t['id']:{r['f']:r for r in t['frames']} for t in px['tracks']}
def iou(a,b):
 a,b=np.array(a),np.array(b);q=np.prod(np.maximum(0,np.minimum(a[2:],b[2:])-np.maximum(a[:2],b[:2])))
 return float(q/max(np.prod(a[2:]-a[:2])+np.prod(b[2:]-b[:2])-q,1))
rows=[]
for i,a in enumerate(px['tracks']):
 if a.get('crash'):continue
 for b in px['tracks'][i+1:]:
  if b.get('crash') or a['class']!=b['class']:continue
  both=sorted(M[a['id']].keys()&M[b['id']].keys())
  if not both:continue
  vals=[iou(M[a['id']][f]['bbox'],M[b['id']][f]['bbox']) for f in both]
  measured=[f for f in both if M[a['id']][f]['src']=='measured' and M[b['id']][f]['src']=='measured']
  vmeas=[iou(M[a['id']][f]['bbox'],M[b['id']][f]['bbox']) for f in measured]
  high=[f for f,v in zip(both,vals) if v>.5]
  if len(high)>=3 and len(high)/len(both)>.4:
   rows.append(dict(ids=[a['id'],b['id']],span=[both[0],both[-1]],overlap_frames=len(both),high_iou=len(high),median_iou=float(np.median(vals)),both_measured=len(measured),median_measured_iou=float(np.median(vmeas)) if vmeas else None))
rows.sort(key=lambda r:r['median_iou'],reverse=True)
ap=argparse.ArgumentParser();ap.add_argument('--out',default='overlap_candidates.json');args=ap.parse_args()
(P/args.out).write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps(rows[:25],indent=1))
