import json,cv2,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent
px=json.load(open(P.parent/'data/tracks_px_clean.json'));M={t['id']:{r['f']:r for r in t['frames']} for t in px['tracks']};tiles=np.load(P/'tiles.npy',mmap_mode='r')
def render(ids,fs):
 ims=[]
 lastbox=None
 for f in fs:
  boxes=[M[id][f]['bbox'] for id in ids if f in M[id]]
  if boxes:lastbox=np.array(boxes)
  if lastbox is None:continue
  B=lastbox;x0=max(0,int(B[:,0].min())-18);y0=max(0,int(B[:,1].min())-12);x1=min(479,int(B[:,2].max())+18);y1=min(300,int(B[:,3].max())+12)
  im=cv2.resize(tiles[f,y0:y1,x0:x1],(420,240),interpolation=cv2.INTER_NEAREST)
  for k,id in enumerate(ids):
   if f not in M[id]:continue
   r=M[id][f];bb=np.array(r['bbox']);u=(bb[[0,2]]-x0)*420/(x1-x0);v=(bb[[1,3]]-y0)*240/(y1-y0);col=[(0,220,255),(255,100,200),(80,255,70)][k]
   cv2.rectangle(im,(int(u[0]),int(v[0])),(int(u[1]),int(v[1])),col,1)
   cv2.putText(im,id+':'+r['src'][0],(3,35+k*18),0,.48,col,1)
  cv2.putText(im,f'f{f} crop({x0},{y0})',(3,18),0,.48,(255,255,255),1);ims.append(im)
 while len(ims)<6:ims.append(np.zeros_like(ims[0]))
 sheet=np.vstack([np.hstack(ims[:3]),np.hstack(ims[3:6])]);cv2.imwrite(str(P/('inspect_'+'_'.join(ids)+'.png')),sheet)
if __name__=='__main__':
 for r in json.load(open(P/'overlap_candidates.json')):
  lo,hi=r['span'];render(r['ids'],sorted(set([max(0,lo-3),lo,int(lo+(hi-lo)/3),int(lo+2*(hi-lo)/3),hi,min(399,hi+4)])))
 for ids,fs in [(['c023','c024','c025'],[0,1,2,3,4,6]),(['c163','c164'],[382,384,389,394,396,399]),(['c098'],[213,217,222,234,244,250]),(['c111'],[250,254,259,263,268,273])]:render(ids,fs)
