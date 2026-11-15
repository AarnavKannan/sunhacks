"""Reproducible W1 source overlays and coverage/kinematics audit (no video re-decode)."""
import json, os, sys
from pathlib import Path
import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import cam
from clean_tracks import lane_of, corners_px

CHECKS = [(0, 0), (10, 125), (15, 188), (17, 212), (17.04, 213), (20, 250), (24, 300), (28, 350), (31.92, 399)]


def atomic(path, value):
    tmp = str(path) + '.tmp'
    with open(tmp, 'w') as h:
        json.dump(value, h, indent=2, allow_nan=False)
    os.replace(tmp, path)


def stamp(im, text, xy, col=(255, 255, 255), scale=.45):
    cv2.putText(im, text, xy, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(im, text, xy, cv2.FONT_HERSHEY_SIMPLEX, scale, col, 1, cv2.LINE_AA)


def render_dets():
    tiles = np.load(HERE / 'tiles.npy', mmap_mode='r')
    det = json.load(open(HERE / 'dets.json'))['frames']
    out = {}
    for target, f in CHECKS:
        if str(f) not in det:
            continue
        D = sorted(det[str(f)], key=lambda d: d['Xc'])
        im = cv2.resize(tiles[f], None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
        for n, d in enumerate(D, 1):
            P = np.array(d['bottom'] + d['top']) * 4
            for a, b in [(0,1),(1,2),(2,3),(3,0),(4,5),(5,6),(6,7),(7,4),(0,4),(1,5),(2,6),(3,7)]:
                cv2.line(im, tuple(np.int32(P[a])), tuple(np.int32(P[b])), (40, 50, 255), 1, cv2.LINE_AA)
            xy = tuple(np.int32(P[:4].mean(0)))
            stamp(im, str(n), xy, scale=.5)
        stamp(im, f'DETECTIONS f={f} t={f/12.5:.2f}s; numbered near to far', (10,1180), scale=.6)
        cv2.imwrite(str(HERE / f'detections_f{f:03d}.png'), im)
        cv2.imwrite(str(HERE / f'detections_far_f{f:03d}.png'), cv2.resize(im[:320,:1250], None, fx=1.4,fy=1.4))
        out[str(f)] = [dict(n=n, lane=lane_of(d['Y']), **{k:d[k] for k in ['class','Xc','Y','fit_px','bbox']}) for n,d in enumerate(D,1)]
    atomic(HERE / 'census_detections.json', out)


def render_world():
    tiles = np.load(HERE / 'tiles.npy', mmap_mode='r')
    world = json.load(open(HERE.parent / 'data' / 'tracks_world.json'))
    rows = []
    eye_path = HERE / 'eye_counts.json'
    eye = json.load(open(eye_path)) if eye_path.exists() else {}
    for target, f in CHECKS:
        im = cv2.resize(tiles[f], None, fx=4,fy=4, interpolation=cv2.INTER_CUBIC)
        entries=[]
        for t in world['tracks']:
            s = next((s for s in t['samples'] if s['f']==f), None)
            if s is None:
                continue
            P = corners_px(s['x'],s['y'],np.deg2rad(s['heading_deg']),t['length_m'],t['width_m'],t['height_m'])
            bb0,bb1=P.min(0),P.max(0)
            if bb1[0]<0 or bb0[0]>478 or bb1[1]<0 or bb0[1]>299:
                continue
            col=(0,230,255) if s['src']=='measured' else (255,150,40)
            for a,b in [(0,1),(1,2),(2,3),(3,0)]:
                cv2.line(im,tuple(np.int32(P[a]*4)),tuple(np.int32(P[b]*4)),col,1,cv2.LINE_AA)
            u,v=cam.to_img(s['x'],s['y'])
            xy=(max(0,min(1900,int(u[0]*4))),max(15,min(1170,int(v[0]*4))))
            stamp(im,t['id'],xy,col,.4)
            entries.append(dict(id=t['id'],lane=s['lane'],src=s['src'],x=s['x'],y=s['y'],sigma_m=s['sigma_m']))
        stamp(im, f'WORLD f={f} t={f/12.5:.2f}s; yellow=measured blue=inferred', (10,1180),scale=.6)
        cv2.imwrite(str(HERE/f'overlay_f{f:03d}.png'),im)
        counts={str(lane):sum(e['lane']==lane for e in entries) for lane in range(8)}
        measured_counts={str(lane):sum(e['lane']==lane and e['src']=='measured' for e in entries) for lane in range(8)}
        er=eye.get(str(f),{})
        delta={str(lane):counts[str(lane)]-er.get('per_lane',{}).get(str(lane),0) for lane in range(8)} if er else None
        bounds=er.get('per_lane_assignment_bounds',{})
        delta_bounds={lane:dict(min=counts[lane]-b['max'],max=counts[lane]-b['min']) for lane,b in bounds.items()}
        rows.append(dict(requested_t=target,f=f,source_t=f/12.5,eye=er,tracks_per_lane=counts,
                         delta_tracks_minus_eye_per_lane=delta,delta_tracks_minus_eye_total=len(entries)-er.get('total',len(entries)),
                         delta_with_manual_lane_assignment_bounds=delta_bounds,
                         measured_tracks_per_lane=measured_counts,
                         delta_measured_tracks_minus_eye_per_lane={lane:n-er.get('per_lane',{}).get(lane,0) for lane,n in measured_counts.items()} if er else None,
                         inferred_track_ids=[e['id'] for e in entries if e['src']!='measured'],
                         total_tracks=len(entries),measured=sum(e['src']=='measured' for e in entries),tracks=entries))
    atomic(HERE/'lane_counts.json',dict(lane_convention='1=median-adjacent, increasing outward to 6; 0=inside median line, 7=beyond straight outer line',
           note='Visible means the reprojected 3-D cuboid intersects the source tile. Eye census is a source review, not a confidence claim for every subpixel horizon identity.', checks=rows))
    S=[s for t in world['tracks'] if not t['crash'] for s in t['samples']]
    a=np.hypot([s['ax'] for s in S],[s['ay'] for s in S]);v=np.array([s['speed_mps'] for s in S])
    force=[];delta=[]
    for t in world['tracks']:
        for s in t['samples']:
            force.append(max(abs(s['fx_n']-t['mass_kg']*s['ax']),abs(s['fy_n']-t['mass_kg']*s['ay'])))
        for s,r in zip(t['samples'],t['samples'][1:]):
            delta.append(abs(r['f']-s['f']-1))
    atomic(HERE/'verification.json',dict(tracks=len(world['tracks']),samples=sum(len(t['samples']) for t in world['tracks']),
        crash_ids=[t['id'] for t in world['tracks'] if t['crash']],
        background_acceleration_mps2=dict(zip(['median','p90','p95','p99','max'],np.quantile(a,[.5,.9,.95,.99,1]).tolist())),
        background_speed_mps=dict(zip(['median','p90','p95','p99','max'],np.quantile(v,[.5,.9,.95,.99,1]).tolist())),
        max_rounded_force_residual_N=max(force),nonconsecutive_samples=sum(d!=0 for d in delta),
        source_counts={src:sum(s['src']==src for t in world['tracks'] for s in t['samples']) for src in ['measured','interpolated','occluded-rest','out-of-view-extrapolated']}))


if __name__=='__main__':
    render_dets()
    if (HERE.parent/'data'/'tracks_world.json').exists():
        render_world()
