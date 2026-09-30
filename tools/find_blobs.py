# tools\find_blobs.py  (JalDrishti root se: python tools\find_blobs.py)
import glob
import numpy as np, rasterio
from scipy import ndimage

RASTERS = sorted(glob.glob("server/data/rasters/tehri_depth/Depth_t*.tif"))
WET = 0.05
RISE = 0.3


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
lat0 = tr.f + tr.e * base.shape[0] / 2
pix_km2 = (abs(tr.a) * 111.32 * np.cos(np.radians(lat0))) * (abs(tr.e) * 110.574)

dry = base <= WET
m = (~dry) & (rise >= RISE)
lab, n = ndimage.label(m)
print(f"channel rise: {n} blobs, total {m.sum() * pix_km2:.1f} km2\n")

objs = ndimage.find_objects(lab)
idx = np.arange(1, n + 1)
area = ndimage.sum(m, lab, idx) * pix_km2

for j in np.argsort(area)[::-1][:4]:
    rows, cols = objs[j]
    lon0, lat_top = tr * (cols.start, rows.start)
    lon1, lat_bot = tr * (cols.stop, rows.stop)
    sel = lab == j + 1
    b, l, r_ = base[sel], last[sel], rise[sel]
    print(f"{area[j]:7.1f} km2  lon {lon0:.3f}..{lon1:.3f}  lat {lat_bot:.3f}..{lat_top:.3f}")
    print(f"   baseline t00 depth : mean {b.mean():6.1f} m  max {b.max():6.1f} m")
    print(f"   depth at t14       : mean {l.mean():6.1f} m  max {l.max():6.1f} m")
    print(f"   RISE (t14 - t00)   : mean {r_.mean():6.1f} m  median {np.median(r_):6.1f} m  max {r_.max():6.1f} m")
    print(f"   pixels rise >= 3 m : {100 * (r_ >= 3).mean():.0f}%   >= 10 m: {100 * (r_ >= 10).mean():.0f}%\n")