# tools\build_impact.py  (JalDrishti root se chalao)
import glob, json, sys
from datetime import datetime
import numpy as np, rasterio, geopandas as gpd
from rasterio.mask import mask
from scipy import ndimage

RASTERS = sorted(glob.glob("server/data/rasters/tehri_depth/Depth_t*.tif"))
print(len(RASTERS), "rasters (t00..t14 expected 15)")
if len(RASTERS) < 2:
    sys.exit("Depth_t*.tif nahi mile. JalDrishti root se chalao.")


def frame_time(f):
    with rasterio.open(f) as r:
        s = r.tags().get("TIFFTAG_IMAGEDESCRIPTION", "")   # 'Depth (06SEP2026 02:00:00)'
    return datetime.strptime(s[s.index("(") + 1:s.index(")")], "%d%b%Y %H:%M:%S")


_t = [frame_time(f) for f in RASTERS]
TIMES_H = np.array([(t - _t[0]).total_seconds() / 3600 for t in _t])
print("frame times (h):", TIMES_H.tolist())

# unique frames: har unique time ka pehla index (t01=t02 jaise duplicates hatao)
_, UIDX = np.unique(np.round(TIMES_H, 4), return_index=True)
UIDX = np.sort(UIDX)
print("unique frames (h):", TIMES_H[UIDX].tolist())

THRESH = 0.3          # m, arrival criterion
RISE = 0.3            # m, standing-pool detection (find_blobs.py jaisa)
NEAR_PX = 10          # ~300 m
NAME_COL = "name"

vil = gpd.read_file("tools/villages.geojson").reset_index(drop=True)
with rasterio.open(RASTERS[0]) as r0:
    vil = vil.to_crs(r0.crs)
print(len(vil), "settlements")


def alert(d):
    return "SEVERE" if d >= 3 else "HIGH" if d >= 1 else "MODERATE" if d >= THRESH else "LOW"


def arrival_interp(fd):
    """Arrival time. Pehle bracket (0-2 h) mein interpolation galat hoti hai
    (0 -> bade depth ka linear ramp), isliye wahan sirf upper bound dete hain.
    Return (arrival_h, method, confidence)."""
    t_u = TIMES_H[UIDX]
    d_u = fd[UIDX]
    hit = np.where(d_u >= THRESH)[0]
    if not len(hit):
        return None, None, None
    k = int(hit[0])
    if k == 0:
        return float(t_u[0]), "frame", "high"
    if k == 1:                                   # 0-2 h ke andar kahin: exact time unknown
        return float(t_u[1]), "bounded", "low"   # arrivalTimeH = upper bound
    t_lo, t_hi = t_u[k - 1], t_u[k]
    d_lo, d_hi = d_u[k - 1], d_u[k]
    if d_hi <= d_lo:
        return float(t_hi), "frame", "low"
    a = t_lo + (THRESH - d_lo) / (d_hi - d_lo) * (t_hi - t_lo)
    return float(a), "interpolated", "medium"


def read(f):
    """Har settlement polygon ke andar ke raster pixels (nodata -> 0)."""
    out = []
    with rasterio.open(f) as r:
        nd = r.nodata
        for geom in vil.geometry:
            try:
                a, _ = mask(r, [geom], crop=True, filled=False)
                a = np.ma.filled(a[0].astype("float64"), np.nan)
                if nd is not None:
                    a[a == nd] = np.nan
                a[a <= -9999] = np.nan
                out.append(np.nan_to_num(a, nan=0.0))
            except ValueError:
                out.append(None)   # polygon raster ke bahar
    return out


def read_full(f):
    with rasterio.open(f) as r:
        a = r.read(1).astype("float32")
        nd, tr = r.nodata, r.transform
    if nd is not None:
        a[a == nd] = np.nan
    a[a <= -9999] = np.nan
    return np.nan_to_num(a, nan=0.0), tr


base = read(RASTERS[0])            # t00 = initial/reservoir depth
mx = np.zeros((len(vil), len(RASTERS)))
p95 = np.zeros_like(mx)
wetn = np.zeros_like(mx)           # wet pixel count (flood pixels) per settlement per frame

for j, f in enumerate(RASTERS):
    cur = read(f)
    for i, (c, b) in enumerate(zip(cur, base)):
        if c is None or b is None:
            continue
        d = np.where(b <= 0.05, np.clip(c, 0, None), 0)               # pixel-wise flood depth
        wet = d[d > 0]
        mx[i, j] = d.max()
        wetn[i, j] = wet.size
        p95[i, j] = np.percentile(wet, 95) if wet.size else 0
    print(f"t{j:02d}/{len(RASTERS)-1:02d} done  ({TIMES_H[j]:.1f} h)", flush=True)

# ---- standing pool (sabse bada channel-rise blob) -> nearPool flag ----
base_full, tr = read_full(RASTERS[0])
last_full, _ = read_full(RASTERS[-1])
m = (base_full > 0.05) & ((last_full - base_full) >= RISE)
lab, n = ndimage.label(m)
sizes = ndimage.sum(m, lab, np.arange(1, n + 1))
pool = lab == (int(np.argmax(sizes)) + 1)
inv = ~tr                                  # raster EPSG:4326 hai (lon, lat -> col, row)
print("pool pixels:", int(pool.sum()))

out = []
for i, row in vil.iterrows():
    fd = p95[i]
    d95 = float(fd.max())
    arr, method, conf = arrival_interp(fd)
    c = gpd.GeoSeries([row.geometry], crs=vil.crs).to_crs(32644).centroid.to_crs(4326).iloc[0]
    col_, row_ = inv * (float(c.x), float(c.y))
    ri, ci = int(row_), int(col_)
    near = bool(pool[max(0, ri - NEAR_PX):ri + NEAR_PX + 1, max(0, ci - NEAR_PX):ci + NEAR_PX + 1].any())
    out.append({
        "name": row.get(NAME_COL),
        "lat": round(c.y, 5),
        "lon": round(c.x, 5),
        "maxDepthM": round(d95, 2),                          # p95 of wet pixels, peak over time
        "peakPixelDepthM": round(float(mx[i].max()), 2),
        "wetPixels": int(wetn[i].max()),                     # peak wet flood-pixel count
        "nearPool": near,                                    # 300 m ke andar standing-pool artifact
        "arrivalTimeH": None if arr is None else round(arr, 2),
        "arrivalMethod": method,                             # "bounded" | "interpolated" | "frame" | None
        "arrivalConfidence": conf,                           # "low" | "medium" | "high" | None
        "alert": alert(d95),
    })

with open("server/data/impact.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=1, ensure_ascii=False)

imp = [o for o in out if o["alert"] != "LOW"]
print(len(imp), "impacted /", len(out), "-> server/data/impact.json")
print("  near pool:", sum(o["nearPool"] for o in imp), "| outside pool:", sum(not o["nearPool"] for o in imp))
print("  wetPixels <= 3 (fragile):", sum(o["wetPixels"] <= 3 for o in imp))
for o in sorted((o for o in out if o["arrivalTimeH"] is not None),
                key=lambda o: o["arrivalTimeH"])[:10]:
    print(o["arrivalTimeH"], "h", o["arrivalMethod"], o["arrivalConfidence"], o["maxDepthM"], "m", o["alert"], o["name"])