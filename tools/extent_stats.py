# tools\extent_stats.py  (root se: python tools\extent_stats.py)
import glob
import numpy as np, rasterio

R = sorted(glob.glob("server/data/rasters/tehri_depth/Depth_t*.tif"))


def rd(f):
    with rasterio.open(f) as r:
        a = r.read(1).astype("float32")
        nd = r.nodata
        tr, crs, shape = r.transform, r.crs, (r.height, r.width)
    if nd is not None:
        a[a == nd] = np.nan
    a[a <= -9999] = np.nan
    return np.nan_to_num(a, nan=0.0), tr, crs, shape


base, tr, crs, shape = rd(R[0])
if crs is not None and crs.is_geographic:
    lat0 = tr.f + tr.e * shape[0] / 2
    pix = (abs(tr.a) * 111.32 * np.cos(np.radians(lat0))) * (abs(tr.e) * 110.574)
else:
    pix = abs(tr.a * tr.e) / 1e6

mx_total = base.copy()
mx_rise = np.zeros_like(base)
for f in R[1:]:
    c, *_ = rd(f)
    mx_total = np.maximum(mx_total, c)
    mx_rise = np.maximum(mx_rise, c - base)

km2 = lambda m: np.count_nonzero(m) * pix
dry0 = base <= 0.05
print("baseline wet area (t00)            : %8.1f km2" % km2(~dry0))
print("wet area at peak (any frame)       : %8.1f km2" % km2(mx_total > 0.05))
print("newly inundated (dry at t00)       : %8.1f km2" % km2(dry0 & (mx_total > 0.05)))
print("channel area, rise >= 0.3 m        : %8.1f km2" % km2((~dry0) & (mx_rise >= 0.3)))
print("channel area, rise >= 3 m          : %8.1f km2" % km2((~dry0) & (mx_rise >= 3)))
print("max rise inside channel            : %8.1f m" % mx_rise[~dry0].max())
print("max depth on newly inundated land  : %8.1f m" % mx_total[dry0].max())