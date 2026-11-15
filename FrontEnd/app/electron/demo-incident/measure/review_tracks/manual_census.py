"""Independent source-image census, hand-entered anchors; no detector/track input.

Coordinates below are read on the 4x SOURCE images. Marks indicate approximate
road-footprint centres for counting only; they are not new trajectory samples.
Lane boundaries come from the common calibration. Small lane-boundary and horizon
assignments carry explicit alternatives. Ambiguous texture outside these marks
is not silently promoted to a vehicle. Re-run to render the marks and eye counts.
"""
import json, sys
from pathlib import Path
import cv2, numpy as np
P=Path(__file__).resolve().parent
sys.path.insert(0,str(P.parent))
import cam
from clean_tracks import lane_of, CRASH_LINES
# SOURCE images were inspected before comparing annotations with delivered IDs.
# Full-image pixels at 4x scale, nearest visible ground footprint, description.
MARKS={
0:[(410,806,'stopped white van'),(163,675,'near dark car'),(178,490,'dark car'),(35,430,'clipped truck'),(457,469,'dark car'),(734,412,'median-side car'),(589,383,'dark car'),(462,355,'dark car'),(654,333,'car'),(742,291,'dark car'),(796,263,'light van'),(843,225,'partly overlapping car'),(910,265,'light car'),(903,184,'light car'),(1005,170,'dark car'),(378,217,'outer car'),(663,154,'outer car'),(858,105,'truck'),(929,73,'truck'),(960,94,'small van'),(1030,88,'small car'),(995,47,'small van behind van'),(952,23,'top-clipped truck'),(1035,24,'top-clipped truck'),(1016,10,'top-clipped truck')],
125:[(408,806,'stopped white van'),(32,801,'clipped dark car'),(380,525,'white van'),(250,474,'dark car'),(700,468,'median-side car'),(625,350,'light car'),(618,285,'van'),(479,333,'van'),(413,290,'truck'),(600,155,'left distant truck'),(681,170,'right distant truck'),(812,105,'truck'),(950,26,'top-clipped truck'),(810,246,'light car'),(912,126,'car'),(970,137,'car'),(1038,144,'car'),(1060,111,'car'),(1073,84,'car'),(1006,90,'car'),(953,104,'car'),(1108,55,'small unboxed horizon car'),(1060,39,'small unboxed horizon car')],
188:[(408,806,'stopped white van'),(20,610,'clipped van'),(235,625,'dark car'),(530,435,'light car'),(742,300,'light car'),(838,325,'dark car'),(918,262,'light car'),(952,225,'dark car'),(835,237,'light car'),(740,211,'dark car'),(697,239,'light car'),(209,270,'outer truck'),(437,280,'large truck'),(580,164,'truck'),(860,98,'truck'),(995,42,'top-clipped truck'),(1073,56,'small van'),(968,93,'car'),(1015,98,'car'),(1065,110,'yellow car'),(1126,63,'car'),(1090,29,'small horizon car'),(1040,30,'small horizon car')],
212:[(408,806,'stopped white van'),(337,574,'partly occluded car beside van'),(4,932,'clipped near car'),(592,399,'light car'),(743,434,'dark car'),(839,352,'light car'),(869,300,'van'),(685,316,'light car'),(556,321,'light car'),(603,277,'car'),(13,340,'clipped outer truck'),(291,355,'large truck'),(250,321,'car beside truck'),(411,215,'truck'),(493,191,'outer car'),(815,122,'truck'),(875,107,'car'),(924,101,'car'),(978,125,'car'),(1006,175,'yellow car'),(1037,101,'car'),(1105,84,'car'),(1055,65,'small van'),(973,52,'partly clipped distant truck'),(1014,36,'top green truck'),(1053,41,'small van behind van')],
213:[(408,806,'stopped white van'),(330,582,'partly occluded car beside van'),(589,402,'light car'),(738,436,'dark car'),(831,353,'light car'),(867,301,'van'),(681,316,'light car'),(552,324,'light car'),(600,279,'car'),(10,343,'clipped outer truck'),(287,363,'large truck'),(246,325,'car beside truck'),(407,219,'truck'),(491,194,'outer car'),(813,124,'truck'),(873,108,'car'),(922,103,'car'),(975,127,'car'),(1003,178,'yellow car'),(1036,104,'car'),(1102,86,'car'),(1053,67,'small van'),(970,55,'partly clipped distant truck'),(1012,38,'top green truck'),(1052,44,'small van behind van')],
250:[(408,806,'stopped white van'),(163,670,'light near car'),(540,607,'partly occluded median car'),(173,516,'light car'),(318,425,'dark car'),(430,490,'light car'),(707,470,'light car'),(745,401,'van'),(829,330,'yellow car'),(35,487,'clipped outer truck'),(170,285,'outer truck'),(282,245,'outer car'),(699,170,'distant truck'),(812,160,'car'),(879,186,'car'),(958,134,'car'),(1025,149,'car'),(1083,101,'car'),(800,105,'outer car'),(841,104,'outer car'),(937,89,'unboxed distant truck'),(1005,77,'distant green truck'),(1016,89,'small van'),(1013,62,'small van behind'),(1040,47,'horizon car'),(1083,46,'horizon car')],
300:[(299,865,'moving white van'),(504,744,'yellow car overlapping van'),(630,561,'white car'),(680,486,'van'),(694,321,'white car'),(532,318,'dark car'),(739,247,'red car'),(863,286,'dark car'),(423,268,'truck'),(653,154,'outer car'),(694,147,'outer car'),(994,193,'car'),(940,143,'small van'),(941,99,'small van'),(965,83,'small van'),(866,94,'distant unboxed truck'),(934,65,'green truck'),(967,47,'top green truck'),(1015,24,'top green truck')],
350:[(94,1030,'white van clipped at left'),(595,593,'white car'),(673,504,'van'),(488,453,'white car'),(378,397,'red car'),(100,519,'left dark car'),(60,411,'clipped truck'),(707,382,'white car'),(886,306,'car'),(793,241,'small van'),(787,187,'small van'),(864,175,'small van'),(829,150,'truck'),(771,147,'unboxed truck'),(930,119,'small car'),(932,73,'truck'),(987,54,'truck'),(1061,74,'small car'),(1126,57,'small van'),(344,231,'outer light car'),(469,214,'outer dark car'),(1023,28,'small horizon car'),(1081,29,'small horizon car')],
399:[(92,1020,'white van clipped at left'),(584,608,'white car'),(352,549,'white car'),(522,467,'dark car'),(671,497,'van'),(795,398,'dark car'),(595,352,'small van'),(540,311,'small van'),(165,341,'outer car'),(6,553,'clipped left car'),(580,234,'unboxed truck'),(684,239,'small van'),(663,155,'car beside truck'),(745,168,'truck'),(793,185,'small car'),(850,106,'truck'),(913,89,'car'),(940,108,'small car'),(996,110,'car'),(1027,97,'car'),(1087,89,'small van'),(1100,93,'overlapping small car'),(1034,42,'top-clipped truck'),(952,39,'top-clipped truck')]
}
# These alternatives are deliberately wider than one integer lane for top boxes:
# row error, occlusion and the painted straight-line model dominate at the horizon.
EXTRA={0:'Top-clipped trucks and small yellow/cyan boxes have uncertain separability/lane. No claim of identity before a box is distinguishable.',125:'Unboxed horizon cars counted as silhouettes; identity unassigned. Two side-by-side distant trucks are distinct.',188:'Occlusion near the van and overlapping distant boxes. First two rows of horizon texture are not countable.',212:'The left-edge sliver is counted once. Yellow is visible well before impact. Cyan car overlaps the near large truck.',213:'The near left-edge sliver visible at f212 has left the crop. Other counts use f213 source itself.',250:'Median-side car partly hidden behind stopped van. Horizon includes two unboxed small silhouettes.',300:'Yellow and white van count as two visible vehicles. Duplicate delivered footprint at the distant median car is not a second source car.',350:'Yellow wreck has no independently separable visible silhouette; excluded from eye count but retained in world as occluded-rest. White van left clipped.',399:'Yellow wreck hidden; excluded from eye count. White van and leftmost car are clipped. Several horizon boxes overlap.'}
UNCERTAIN_SILHOUETTES={0:[22,23,24,25],125:[22,23],188:[22,23],212:[24,25,26],213:[23,24,25],250:[23,24,25,26],300:[17,18,19],350:[22,23],399:[21,22,23,24]}

def main():
 tiles=np.load(P/'tiles.npy',mmap_mode='r');out={}
 for f,marks in MARKS.items():
  entries=[];im=cv2.resize(tiles[f],None,fx=4,fy=4,interpolation=cv2.INTER_CUBIC)
  for i,(u4,v4,note) in enumerate(marks,1):
   u,v=u4/4,v4/4;X,Y=cam.to_ground(u,v);lane=lane_of(float(Y[0]))
   far=v<30; edge=u<15 or u>470 or v<4
   # Manual anchor uncertainty + camera row/range ambiguity. Alternatives are
   # labels only and never move source or delivered samples.
   candidates={lane}
   if far:
    candidates|={max(0,lane-1),min(7,lane+1)}
    for du in [-1.5,1.5]:
     for dv in [-1.5,1.5]:
      _,yy=cam.to_ground(u+du,v+dv);candidates.add(lane_of(float(yy[0])))
    if v<8:
     candidates.update(range(1,8))
   else:
    for dv in [-1.5,1.5]:
     _,yy=cam.to_ground(u,v+dv);candidates.add(lane_of(float(yy[0])))
   entries.append(dict(mark=i,anchor_px=[u,v],lane=lane,possible_lanes=sorted(candidates),description=note,
                       silhouette_separability_uncertain=i in UNCERTAIN_SILHOUETTES[f],
                       horizon=far,clipped=edge,confidence='uncertain-lane' if len(candidates)>1 else 'clear'))
   col=(60,220,255) if far else (80,255,90)
   cv2.circle(im,(u4,v4),8,col,2)
   label=f'{i}:L{lane}'+('?' if len(candidates)>1 else '')
   cv2.putText(im,label,(min(1780,u4+8),max(15,v4-7)),0,.42,(0,0,0),3,cv2.LINE_AA)
   cv2.putText(im,label,(min(1780,u4+8),max(15,v4-7)),0,.42,col,1,cv2.LINE_AA)
  counts={str(l):sum(e['lane']==l for e in entries) for l in range(8)}
  bounds={str(l):dict(min=sum(e['possible_lanes']==[l] for e in entries),max=sum(l in e['possible_lanes'] for e in entries)) for l in range(8)}
  out[str(f)]=dict(per_lane=counts,total=len(entries),per_lane_assignment_bounds=bounds,
    count_excluding_uncertain_silhouettes=len(entries)-len(UNCERTAIN_SILHOUETTES[f]),
    uncertain_silhouette_marks=UNCERTAIN_SILHOUETTES[f],
    count_interpretation='Primary manual count of marked source silhouettes. Assignment bounds allow the same marks to change lanes; they are not statistical confidence intervals or a full-recall bound. Horizon separability can also change the total.',
    visible_only=True,hidden_retained_crash_vehicles=1 if f>=350 else 0,notes=EXTRA[f],marks=entries,
    residual='Not a full-recall certificate: subpixel/fully occluded source traffic and exact horizon lane membership cannot be established from these images.')
  cv2.imwrite(str(P/'eye'/f'manual_f{f:03d}.png'),im)
 (P/'eye_counts.json').write_text(json.dumps(out,indent=2)+'\n')
 print([(f,v['per_lane'],v['total']) for f,v in out.items()])
if __name__=='__main__':main()
