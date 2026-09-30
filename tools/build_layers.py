# tools\build_layers.py  (JalDrishti root se: python tools\build_layers.py)
import glob, json, os, sys
from datetime import datetime
import numpy as np, rasterio

RASTERS = sorted(glob.glob("server/data/rasters/tehri_depth/Depth_t*.tif"))
print(len(RASTERS), "rasters")
if len(RASTERS) < 2:
    sys.exit("Depth_t*.tif nahi mile. JalDrishti root se chalao.")


def frame_time(f):
    with rasterio.open(f) as r:
        s = r.tags().get("TIFFTAG_IMAGEDESCRIPTION", "")   # 'Depth (06SEP2026 02:00:00)'
    return datetime.strptime(s[s.index("(") + 1:s.index(")")], "%d%b%Y %H:%M:%S")


_t = [frame_time(f) for f in RASTERS]
TIMES_H = np.array([(t - _t[0]).total_seconds() / 3600 for t in _t])
_, UIDX = np.unique(np.round(TIMES_H, 4), return_index=True)
UIDX = np.sort(UIDX)
T_U = TIMES_H[UIDX]
print("unique frames (h):", T_U.tolist())

THRESH = 0.3     # m, arrival criterion
WET = 0.05       # m, baseline dry / flood extent threshold
CHANNEL_RISE_MIN = 0.3   # m, t00 mein already-wet pixel par isse kam rise = noise
OUT_DIR = "server/data/rasters/derived"
os.makedirs(OUT_DIR, exist_ok=True)


def read_depth(f):
    with rasterio.open(f) as r:
        a = r.read(1).astype("float32")
        nd = r.nodata
    if nd is not None:
        a[a == nd] = np.nan
    a[a <= -9999] = np.nan
    return np.nan_to_num(a, nan=0.0)


with rasterio.open(RASTERS[0]) as r0:
    profile = r0.profile.copy()
    shape = (r0.height, r0.width)
for k in ("blockxsize", "blockysize", "tiled", "photometric", "interleave"):
    profile.pop(k, None)
profile.update(dtype="float32", count=1, nodata=-9999.0, compress="lzw")

base = read_depth(RASTERS[0])
dry = base <= WET                      # t00 mein dry pixels

prev = np.zeros(shape, dtype="float32")        # pichle unique frame ka newly-inundated depth
max_new = np.zeros(shape, dtype="float32")     # newly inundated (t00 dry)  -> Max extent + Arrival
max_ch = np.zeros(shape, dtype="float32")      # channel rise (t00 wet)     -> alag, unvalidated
arrival = np.full(shape, np.nan, dtype="float32")

for k in range(1, len(UIDX)):
    c = read_depth(RASTERS[UIDX[k]])
    if c.shape != shape:
        sys.exit(f"Raster grid match nahi karta: {RASTERS[UIDX[k]]}")
    rise = c - base
    f_new = np.where(dry, np.clip(c, 0, None), 0).astype("float32")
    f_ch = np.where(~dry & (rise >= CHANNEL_RISE_MIN), rise, 0).astype("float32")
    max_new = np.maximum(max_new, f_new)
    max_ch = np.maximum(max_ch, f_ch)
    new = np.isnan(arrival) & (f_new >= THRESH)
    if k == 1:
        arrival[new] = T_U[1]                   # bounded: <= pehla interval
    else:
        t_lo, t_hi = T_U[k - 1], T_U[k]
        d_lo, d_hi = prev[new], f_new[new]
        denom = np.where(d_hi > d_lo, d_hi - d_lo, np.nan)
        a = t_lo + (THRESH - d_lo) / denom * (t_hi - t_lo)
        a = np.where(np.isnan(a), t_hi, a)
        arrival[new] = np.clip(a, t_lo, t_hi)
    prev = f_new
    print(f"frame {k}/{len(UIDX)-1} done ({T_U[k]:.1f} h)", flush=True)

# approx pixel area (km2)
crs, tr = profile.get("crs"), profile["transform"]
if crs is not None and crs.is_geographic:
    lat0 = tr.f + tr.e * shape[0] / 2
    pix_km2 = (abs(tr.a) * 111.32 * np.cos(np.radians(lat0))) * (abs(tr.e) * 110.574)
else:
    pix_km2 = abs(tr.a * tr.e) / 1e6

print("\nnewly inundated (t00 dry), depth > %.2f m : ~%.1f km2" % (WET, np.count_nonzero(max_new > WET) * pix_km2))
print("channel rise >= %.1f m (t00 wet), UNVALIDATED : ~%.1f km2" % (CHANNEL_RISE_MIN, np.count_nonzero(max_ch > 0) * pix_km2))
with np.errstate(invalid="ignore"):
    for lo, hi, name in [(0, 2.0001, "<= 2 h"), (2.0001, 4, "2-4 h"), (4, 6, "4-6 h"), (6, 8, "6-8 h"),
                         (8, 10, "8-10 h"), (10, 12, "10-12 h"), (12, 14.0001, "12-14 h")]:
        n = np.count_nonzero((arrival > lo) & (arrival <= hi))
        print(f"  arrival {name:8}: ~{n * pix_km2:8.1f} km2")

max_new[max_new <= WET] = np.nan
max_ch[max_ch <= 0] = np.nan


def write(name, arr):
    out = np.where(np.isnan(arr), -9999.0, arr).astype("float32")
    with rasterio.open(os.path.join(OUT_DIR, name), "w", **profile) as dst:
        dst.write(out, 1)


write("Max_Flood_Depth.tif", max_new)
write("Arrival_Time_h.tif", arrival)
write("Channel_Rise_Max.tif", max_ch)

manifest = {
    "dir": "tehri_depth",
    "files": [os.path.basename(f) for f in RASTERS],
    "hours": [round(float(h), 3) for h in TIMES_H],
    "uniqueIdx": [int(i) for i in UIDX],
}
with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=1)

print("\nwritten ->", OUT_DIR)