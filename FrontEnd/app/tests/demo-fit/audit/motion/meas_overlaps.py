"""Which measured (pre-generator) tracks overlap the vehicles the generator moved."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_motion import DI, drawn, corners, penetration, X_REF, Y_MED, N
import build_cat  # noqa
tw = json.load(open(os.path.join(DI, "measure", "data", "tracks_world.json")))
T = {t["id"]: t for t in tw["tracks"] if t["id"] not in ("yellow-car",)}
P = {i: {s["f"]: (X_REF - s["x"], s["y"] - Y_MED, (180 - s["heading_deg"] + 180) % 360 - 180, s["src"]) for s in t["samples"] if s["f"] < N} for i, t in T.items()}
S = {i: drawn(build_cat.category_of(t["class"], t["length_m"]), t["length_m"]) for i, t in T.items()}
targets = sys.argv[1:]
for a in targets:
    res = {}
    for b in T:
        if b == a: continue
        for f, pa in P[a].items():
            pb = P[b].get(f)
            if not pb or abs(pa[0] - pb[0]) > 20 or abs(pa[1] - pb[1]) > 6: continue
            d = penetration(corners(*pa[:3], *S[a]), corners(*pb[:3], *S[b]))
            if d > 0: res.setdefault(b, []).append((f, round(d, 2), round(pa[0], 1), round(pa[1]-pb[1], 2), round(pa[0]-pb[0], 2), pa[3], pb[3]))
    print("==", a, T[a]["class"], T[a]["length_m"], "frames", T[a]["f_first"], T[a]["f_last"], "nmeas", T[a]["n_measured"], "of", len(P[a]))
    for b, L in res.items():
        print("   vs", b, T[b]["class"], T[b]["length_m"], "n", len(L), "frames", L[0][0], L[-1][0], "maxdepth", max(l[1] for l in L), "sample", L[len(L)//2])
