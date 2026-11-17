import json, numpy as np, os
D=os.path.dirname(os.path.abspath(__file__))
W={t["id"]:t for t in json.load(open(D+"/synth_world.json"))["tracks"]}
for tr in json.load(open(D+"/synth_truth.json")):
    sm={s["f"]:s for s in W[tr["id"]]["samples"]}
    ex=[sm[s["f"]]["x"]-s["x"] for s in tr["samples"] if s["f"] in sm]
    ey=[sm[s["f"]]["y"]-s["y"] for s in tr["samples"] if s["f"] in sm]
    ev=[sm[s["f"]]["vx"]-s["v"] for s in tr["samples"] if s["f"] in sm]
    print(tr["id"], "x bias %.2f sd %.2f | y rms %.2f | vx rms %.2f max %.2f"%(np.mean(ex),np.std(ex),np.sqrt(np.mean(np.square(ey))),np.sqrt(np.mean(np.square(ev))),np.max(np.abs(ev))))
    if tr["id"] in("c1","v1"):
        for f in ([195,200,205,210,220,235] if tr["id"]=="c1" else [270,276,279,282,290]):
            if f in sm: s=sm[f]; t=[q for q in tr["samples"] if q["f"]==f][0]; print("  f",f,"v_true",round(t["v"],2),"vx",s["vx"],"ax",s["ax"],s["cause"])
