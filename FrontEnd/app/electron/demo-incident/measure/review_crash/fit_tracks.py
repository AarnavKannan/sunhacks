"""Reproducible intermediate cuboid fits; only reads the cached source tiles."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import crash_pair as c
import cv2
import numpy as np
from scipy.optimize import minimize

OUT = os.path.dirname(os.path.abspath(__file__))

def save(name, obj):
    p = os.path.join(OUT, name)
    with open(p + '.tmp', 'w') as out:
        json.dump(obj, out, indent=1)
    os.replace(p + '.tmp', p)

def fit(f, pred, dims, typ, margin=5, prior=(3., .45, .25)):
    im = c.tile(f)
    mask = c.wire_masks(im)[typ]
    roi = c.roi_mask(mask.shape, c.corners([*pred,*dims]),margin)
    mask &= roi
    yy,xx = np.where(mask)
    pts = np.c_[xx,yy].astype(float)
    D = c.dist_map(mask)
    def fun(q):
        P=c.corners([*q,*dims])
        fw,_=c.fwd_cost(P,D)
        reg=.10*np.sum(((q-np.array(pred))/prior)**2)
        return fw+.55*c.rev_cost(P,pts)+reg
    opt=minimize(fun,pred,method='Nelder-Mead',options={'maxiter':220,'xatol':.003,'fatol':.0003,
       'initial_simplex':np.array(pred)+np.array([[0,0,0],[.8,0,0],[0,.16,0],[0,0,.10]])})
    p=[*opt.x,*dims];err,inside=c.fwd_cost(c.corners(p),D)
    return {'f':f,'p':list(map(float,p)),'err_px':err,'inside':inside,'n_wire':len(pts)}

def car_back():
    dims=[4.3,1.8,1.5]
    seed=fit(266,[130.5,-15.8,3.02],dims,'car')
    tr={266:seed};prev=np.array(seed['p'][:3]);vel=np.array([1.8,0.,0.])
    for f in range(265,-1,-1):
        pred=prev+vel
        pred[2]=np.clip(pred[2],2.85,3.4)
        r=fit(f,pred,dims,'car',margin=3,prior=(3,.3,.18));q=np.array(r['p'][:3])
        vel=.6*vel+.4*(q-prev);vel[0]=np.clip(vel[0],.5,3.5);vel[1]=np.clip(vel[1],-.3,.3);vel[2]=np.clip(vel[2],-.02,.02)
        tr[f]=r;prev=q
        if f%20==0:print('car',f,np.round(q,2),round(r['err_px'],2),flush=True)
    save('car_back_raw.json',[tr[f] for f in sorted(tr)])

def van():
    dims=[5.0537455,2.05,2.656723]
    prev=np.array([80.5643,-10.3684,np.pi+.00924]);vel=np.zeros(3);tr=[]
    for f in range(400):
        pred=prev+vel
        r=fit(f,pred,dims,'van',margin=4,prior=(1.5,.2,.13));q=np.array(r['p'][:3])
        vel=.5*vel+.5*(q-prev);vel[0]=np.clip(vel[0],-1.5,.3);vel[1]=np.clip(vel[1],-.12,.12);vel[2]=np.clip(vel[2],-.03,.03)
        tr.append(r);prev=q
        if f%25==0:print('van',f,np.round(q,2),round(r['err_px'],2),flush=True)
    save('van_raw.json',tr)

def car_forward():
    dims=[4.3,1.8,1.5]
    prev=np.array([130.5,-15.8,3.02]);vel=np.array([-1.8,.2,-.06]);tr=[]
    for f in range(267,318):
        pred=prev+vel
        r=fit(f,pred,dims,'car',margin=6,prior=(2.5,.6,.4));q=np.array(r['p'][:3])
        vel=.5*vel+.5*(q-prev);vel[0]=np.clip(vel[0],-3.5,.5);vel[1]=np.clip(vel[1],-.7,.7);vel[2]=np.clip(vel[2],-.3,.3)
        tr.append(r);prev=q
        print('forward',f,np.round(q,3),round(r['err_px'],2),flush=True)
    save('car_forward_raw.json',tr)

if __name__=='__main__':
    {'back':car_back,'forward':car_forward,'van':van}[sys.argv[1]]()
