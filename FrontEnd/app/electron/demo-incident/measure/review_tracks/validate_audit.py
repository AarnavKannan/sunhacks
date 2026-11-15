"""Real W1 audit integrity checks. These do not certify source recall or physics."""
import hashlib,json,math
from collections import Counter
from pathlib import Path
import numpy as np
P=Path(__file__).resolve().parent;D=P.parent/'data';ROOT=P.parents[5]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text(),parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
px=read(D/'tracks_px_clean.json');w=read(D/'tracks_world.json');cp=read(D/'crash_pair.json');counts=read(P/'lane_counts.json')
assert len({t['id'] for t in px['tracks']})==len(px['tracks'])
assert {t['id'] for t in px['tracks']}=={t['id'] for t in w['tracks']}
assert w['frames']==px['frames']==400 and w['fps']==px['fps']==12.5
assert w['source_sha256']['tracks_px_clean']==digest(D/'tracks_px_clean.json')
assert w['source_sha256']['crash_pair']==digest(D/'crash_pair.json')
assert px['source_sha256']['identity_review']==digest(P/'identity_corrections.json')
assert px['source_sha256']['detections']==digest(P/'dets.json')
initial=read(P/'audit_initial_hashes.json')
cache=read(P/'source_cache_verification.json')['demo_32s.mp4']
assert cache['cache_mismatched_frames']==0 and cache['frames']==400
assert cache['sha256']==digest(ROOT/'demo_32s.mp4')
for name in ['crash_pair.json','calib_joint.json','br_camera.json']:
 key=next(k for k in initial if k.endswith('/'+name));assert digest(D/name)==initial[key],name
M={t['id']:t for t in px['tracks']};forces=[];reverse=[];lanechanges=[];high=[];gated=0
for t in w['tracks']:
 S=t['samples'];F=[s['f'] for s in S]
 assert F==list(range(t['f_first'],t['f_last']+1))
 assert F==[s['f'] for s in M[t['id']]['frames']]
 for s in S:
  assert abs(s['t']-s['f']/12.5)<1e-8
  for k,v in s.items():
   if isinstance(v,(int,float)):assert math.isfinite(v),(t['id'],k,v)
  forces.append(max(abs(s['fx_n']-t['mass_kg']*s['ax']),abs(s['fy_n']-t['mass_kg']*s['ay'])))
 if t['crash']:
  assert S==cp['vehicles'][t['id']]['samples'],t['id']
 else:
  PXF={s['f']:s for s in M[t['id']]['frames']}
  for s in S:
   if s['src']=='measured':assert PXF[s['f']]['src']=='measured'
   gated+=int(PXF[s['f']]['src']=='measured' and s['src']!='measured')
  if max(s['vx'] for s in S)>3:reverse.append(dict(id=t['id'],max_vx=max(s['vx'] for s in S)))
  if max(s['speed_mps'] for s in S)>45:
   s=max(S,key=lambda s:s['speed_mps']);high.append(dict(id=t['id'],f=s['f'],speed_mps=s['speed_mps'],sigma_v_mps=s['sigma_v_mps'],sigma_m=s['sigma_m'],x=s['x'],caveats=t['kinematics_caveats']))
 lanes=[]
 for s in S:
  if not lanes or s['lane']!=lanes[-1]:lanes.append(s['lane'])
 if len(lanes)>1:lanechanges.append(dict(id=t['id'],lane_sequence=lanes))
assert max(forces)<.051
assert [r['f'] for r in counts['checks']]==[0,125,188,212,213,250,300,350,399]
for r in counts['checks']:
 e=r['eye'];assert e and len(e['marks'])==e['total']==sum(e['per_lane'].values())
 assert r['total_tracks']==sum(r['tracks_per_lane'].values())
 assert r['delta_tracks_minus_eye_total']==r['total_tracks']-e['total']
 assert r['delta_tracks_minus_eye_per_lane']=={l:n-e['per_lane'][l] for l,n in r['tracks_per_lane'].items()}
assert not read(P/'overlap_candidates_final.json')
alltracks=px['tracks']+px['reserved_crash_silhouette_tracks']+px['excluded_source_part_tracks']
fits=sum(1+len(s.get('alternate_measurements',[])) for t in alltracks for s in t['frames'] if s['src']=='measured')
assert fits==px['identity_review_conservation']['measured_fits_before']==9090
assert px['identity_review_conservation']['exact_measured_evidence_multiset_preserved']
repro=P/'reproduced_clean.json'
assert repro.exists() and digest(repro)==digest(D/'tracks_px_clean.json'),'Clean pipeline reproduction differs'
files=[ROOT/'demo_32s.mp4',D/'calib_joint.json',D/'br_camera.json',D/'crash_pair.json',D/'tracks_px_clean.json',D/'tracks_world.json',P.parent/'detect_track.py',P.parent/'clean_tracks.py',P.parent/'world_kinematics.py',P/'dets.json',P/'identity_corrections.json',P/'eye_counts.json',P/'lane_counts.json',P/'source_cache_verification.json',P/'manual_census.py',P/'review.py',P/'validate_audit.py']
hashes={str(p.relative_to(ROOT)):digest(p) for p in files}
result=dict(status='integrity checks passed; visual coverage and physical truth not certified',tracks=len(w['tracks']),samples=sum(len(t['samples']) for t in w['tracks']),
 manual_frames=[r['f'] for r in counts['checks']],exact_source_fits_retained=fits,crash_pair_samples_unchanged=sum(len(v['samples']) for v in cp['vehicles'].values()),
 canonical_measured_fits_gated=gated,max_rounded_force_residual_N=max(forces),same_class_overlap_candidates_remaining=0,
 retained_high_speed_estimates=sorted(high,key=lambda r:r['speed_mps'],reverse=True),reverse_estimates_over_3_mps=reverse,
 lane_changes_preserved=lanechanges,hashes=hashes)
(P/'audit_validation.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['hashes','retained_high_speed_estimates','lane_changes_preserved']},indent=2))
