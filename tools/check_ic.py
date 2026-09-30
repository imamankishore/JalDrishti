import re, sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling

ROOT = Path(__file__).resolve().parent.parent
D = next(p for p in ROOT.rglob("tehri_depth") if p.is_dir())

def num(p):
    m = re.findall(r"\d+", p.stem.split(".")[0])
    return int(m[-1]) if m else -1

tifs = sorted(list(D.glob("*.tif")), key=num)

# DEM: argv[1] ya search
dem_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
if dem_path is None:
    found = [p for p in ROOT.rglob("*DEM_30m*.tif") if not p.name.startswith("Depth_")]
    if not found:
        print("DEM nahi mila. Chalao: python tools\\check_ic.py <path\\to\\DEM.tif>")
        sys.exit(1)
    dem_path = found[0]
print("DEM:", dem_path)

def rd(path):
    with rasterio.open(path) as s:
        a = s.read(1).astype("float64")
        nd = s.nodata
        if nd is not None:
            a[a == nd] = np.nan
        return a, s.transform, s.res, s.crs, s.shape

d0, tr, res, crs, shp = rd(tifs[0])
d14, *_ = rd(tifs[-1])
d0[d0 < 0] = np.nan
d14[d14 < 0] = np.nan
d0 = np.nan_to_num(d0)
d14 = np.nan_to_num(d14)

with rasterio.open(dem_path) as s:
    if s.shape == shp and s.transform == tr:
        dem = s.read(1).astype("float64")
        if s.nodata is not None:
            dem[dem == s.nodata] = np.nan
    else:
        print("DEM grid alag hai, resample kar raha hoon")
        dem = np.full(shp, np.nan)
        reproject(rasterio.band(s, 1), dem, dst_transform=tr, dst_crs=crs,
                  resampling=Resampling.bilinear)

wet0 = d0 > 0.05
wet14 = d14 > 0.05
rise = d14 - d0
pool = wet0 & (rise > 0.05)

# edges
for name, m in (("t00", wet0), ("t14", wet14)):
    print(f"{name} wet edge cells  N:{int(m[0].sum())} S:{int(m[-1].sum())} "
          f"W:{int(m[:, 0].sum())} E:{int(m[:, -1].sum())}")

wse0 = dem + d0
wse14 = dem + d14
print("\nPOOL WSE t00 (m) pcts 1/25/50/75/99:",
      np.nanpercentile(wse0[pool], [1, 25, 50, 75, 99]).round(1))
print("POOL WSE t00 std:", round(float(np.nanstd(wse0[pool])), 2))
print("POOL WSE t14 std:", round(float(np.nanstd(wse14[pool])), 2))
print("POOL depth t00 mean/max:", d0[pool].mean().round(1), d0[pool].max().round(1))

# top blobs
try:
    from scipy import ndimage
    lab, n = ndimage.label(wet0)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    order = np.argsort(sizes)[::-1][:6]
    print("\nTop t00 wet components (cells, WSE min/median/max/std, depth mean):")
    for i in order:
        m = lab == (i + 1)
        w = wse0[m]
        print(f"  #{i+1}: {int(sizes[i])} cells | WSE {np.nanmin(w):.1f}/"
              f"{np.nanmedian(w):.1f}/{np.nanmax(w):.1f} std {np.nanstd(w):.2f} | "
              f"depth mean {d0[m].mean():.1f}")
except ImportError:
    print("scipy nahi hai: pip install scipy (blob breakdown ke liye)")