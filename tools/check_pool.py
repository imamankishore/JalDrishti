# tools\check_pool.py  (JalDrishti root se: python tools\check_pool.py)
import glob, json
import numpy as np, rasterio
from scipy import ndimage

RASTERS = sorted(glob.glob("server/data/rasters/tehri_depth/Depth_t*.tif"))
WET = 0.05
RISE = 0.3
NEAR_PX = 10          # ~300 m agar cell 30 m hai


def read(f):
    with rasterio.open(f) as r:
        a = r.read(1).astype("float32")
        nd = r.nodata
        tr = r.transform
    if nd is not None:
        a[a == nd] = np.nan
    a[a <= -9999] = np.nan
    return np.nan_to_num(a, nan=0.0), tr


base, tr = read(RASTERS[0])
last, _ = read(RASTERS[-1])
rise = last - base
m = (base > WET) & (rise >= RISE)
lab, n = ndimage.label(m)
sizes = ndimage.sum(m, lab, np.arange(1, n + 1))
pool = lab == (int(np.argmax(sizes)) + 1)
print("pixel size (deg):", abs(tr.a), abs(tr.e), "| pool pixels:", int(pool.sum()))

with open("server/data/impact.json", encoding="utf-8") as fh:
    data = json.load(fh)
rows = data["settlements"] if isinstance(data, dict) else data

inv = ~tr
near, out = [], []
for s in rows:
    col, row = inv * (s["lon"], s["lat"])
    row, col = int(row), int(col)
    r0, r1 = max(0, row - NEAR_PX), min(base.shape[0], row + NEAR_PX + 1)
    c0, c1 = max(0, col - NEAR_PX), min(base.shape[1], col + NEAR_PX + 1)
    hit = bool(pool[r0:r1, c0:c1].any())
    (near if hit else out).append(s)

def by_alert(lst):
    d = {}
    for s in lst:
        d[s.get("alert")] = d.get(s.get("alert"), 0) + 1
    return d

print(f"\nTotal settlements       : {len(rows)}")
print(f"Pool ke {NEAR_PX} px ke andar : {len(near)}  {by_alert(near)}")
print(f"Pool se door            : {len(out)}  {by_alert(out)}")
print("\nPool se door wali settlements:")
for s in out:
    print(f"  {s.get('name')}  {s.get('alert')}  depth {s.get('maxDepthM')}")