import re, sys
from pathlib import Path
import numpy as np, rasterio

ROOT = Path(__file__).resolve().parent.parent

# tehri_depth folder dhoondo
cands = [p for p in ROOT.rglob("tehri_depth") if p.is_dir()]
if not cands:
    print("tehri_depth folder nahi mila under", ROOT)
    print("server/data/rasters ki listing:")
    for p in sorted((ROOT / "server" / "data" / "rasters").rglob("*"))[:60]:
        print("  ", p.relative_to(ROOT))
    sys.exit(1)

D = cands[0]
tifs = list(D.glob("*.tif")) + list(D.glob("*.tiff"))
if not tifs:
    print("Folder mila:", D)
    print("Andar ki files:", [p.name for p in D.iterdir()][:40])
    sys.exit(1)

def num(p):
    m = re.findall(r"\d+", p.stem)
    return int(m[-1]) if m else -1

tifs.sort(key=num)
print("Folder:", D)
print("Files:", [p.name for p in tifs])
f0, f14 = tifs[0], tifs[-1]
print("Using first:", f0.name, "| last:", f14.name)

def rd(path):
    with rasterio.open(path) as s:
        a = s.read(1).astype("float64")
        nd = s.nodata
        if nd is not None:
            a[a == nd] = np.nan
        a[a < 0] = np.nan
        return a, s.transform, s.res

a0, tr, res = rd(f0)
a14, _, _ = rd(f14)

rows = np.arange(a0.shape[0])
lat = tr.f + (rows + 0.5) * tr.e
cell = (res[0] * 111320 * np.cos(np.radians(lat)) * res[1] * 110540)[:, None]  # m2

d0 = np.nan_to_num(a0)
d14 = np.nan_to_num(a14)
wet0 = d0 > 0.05
rise = d14 - d0
pool = wet0 & (rise > 0.05)

print("t00 wet area km2:", (cell * wet0).sum() / 1e6)
print("t00 water volume km3:", (d0 * cell * wet0).sum() / 1e9)
print("rise volume km3 (last-first):", (rise * cell * (rise > 0)).sum() / 1e9)
print("pool rise volume km3:", (rise * cell * pool).sum() / 1e9)
if pool.any():
    print("pool rise mean/std m:", rise[pool].mean(), rise[pool].std())
print("Tehri storage ref ~3.5 km3")
print("wet cells on southern edge row t00:", int(wet0[-1].sum()), "/", wet0.shape[1])