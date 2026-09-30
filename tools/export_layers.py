# tools\export_layers.py  (JalDrishti root se: python tools\export_layers.py)
# Output: server/data/export/  ->  settlements + newly_inundated  (.geojson, .kml, .shp)
import glob, json, os
from xml.sax.saxutils import escape
import numpy as np, rasterio
from rasterio.features import shapes
from scipy import ndimage

RASTERS = sorted(glob.glob("server/data/rasters/tehri_depth/Depth_t*.tif"))
WET, RISE, NEAR_PX = 0.05, 0.3, 10
OUT = "server/data/export"
os.makedirs(OUT, exist_ok=True)

with open("server/data/rasters/derived/manifest.json", encoding="utf-8") as fh:
    UIDX = json.load(fh)["uniqueIdx"]


def read(f):
    with rasterio.open(f) as r:
        a = r.read(1).astype("float32")
        nd, tr = r.nodata, r.transform
    if nd is not None:
        a[a == nd] = np.nan
    a[a <= -9999] = np.nan
    return np.nan_to_num(a, nan=0.0), tr


base, tr = read(RASTERS[0])
dry = base <= WET

# max depth over unique frames (sirf t00-dry pixels) + last frame rise for pool
max_new = np.zeros(base.shape, dtype="float32")
last = base
for i in UIDX[1:]:
    c, _ = read(RASTERS[i])
    max_new = np.maximum(max_new, np.where(dry, np.clip(c, 0, None), 0))
    last = c
new_mask = max_new > WET

# standing pool = sabse bada channel-rise blob (find_blobs.py wala blob 1)
m = (~dry) & ((last - base) >= RISE)
lab, n = ndimage.label(m)
sizes = ndimage.sum(m, lab, np.arange(1, n + 1))
pool = lab == (int(np.argmax(sizes)) + 1)
pool_near = ndimage.binary_dilation(pool, iterations=NEAR_PX)


def conf(near):
    return ("LOW - near unvalidated model pool/artifact" if near
            else "MEDIUM - HEC-RAS baseline, unvalidated")


# ---------- settlements ----------
with open("server/data/impact.json", encoding="utf-8") as fh:
    data = json.load(fh)
rows = data["settlements"] if isinstance(data, dict) else data

inv = ~tr
feats_s = []
for s in rows:
    if s.get("alert") in (None, "LOW"):
        continue
    col, row = inv * (s["lon"], s["lat"])
    row, col = int(row), int(col)
    near = bool(0 <= row < base.shape[0] and 0 <= col < base.shape[1] and pool_near[row, col]) \
        or bool(pool[max(0, row - NEAR_PX):row + NEAR_PX + 1, max(0, col - NEAR_PX):col + NEAR_PX + 1].any())
    feats_s.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
        "properties": {
            "name": s.get("name") or "unnamed",
            "alert": s.get("alert"),
            "depth_m": round(float(s.get("maxDepthM") or 0), 2),
            "arr_h": s.get("arrivalTimeH"),
            "arr_meth": s.get("arrivalMethod"),
            "near_pool": near,
            "conf": conf(near),
        },
    })

# ---------- newly inundated polygons ----------
lab2, n2 = ndimage.label(new_mask, structure=np.ones((3, 3)))
feats_p = []
if n2:
    idx = np.arange(1, n2 + 1)
    mx = ndimage.maximum(max_new, lab2, idx)
    near_flag = ndimage.maximum(pool_near.astype("uint8"), lab2, idx) > 0
    for geom, val in shapes(lab2.astype("int32"), mask=lab2 > 0, transform=tr, connectivity=8):
        k = int(val) - 1
        feats_p.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "depth_m": round(float(mx[k]), 2),
                "near_pool": bool(near_flag[k]),
                "conf": conf(bool(near_flag[k])),
            },
        })


def save_geojson(name, feats):
    with open(os.path.join(OUT, name + ".geojson"), "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh)


def desc(p):
    return "; ".join(f"{k}={v}" for k, v in p.items() if k != "name")


def ring(coords):
    return " ".join(f"{x:.6f},{y:.6f},0" for x, y in coords)


def poly_kml(rings):
    s = f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{ring(rings[0])}</coordinates></LinearRing></outerBoundaryIs>"
    for r in rings[1:]:
        s += f"<innerBoundaryIs><LinearRing><coordinates>{ring(r)}</coordinates></LinearRing></innerBoundaryIs>"
    return s + "</Polygon>"


def save_kml(name, feats, title):
    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
             f"<name>{escape(title)}</name>"]
    for f in feats:
        p, g = f["properties"], f["geometry"]
        if g["type"] == "Point":
            geo = f"<Point><coordinates>{g['coordinates'][0]:.6f},{g['coordinates'][1]:.6f},0</coordinates></Point>"
        else:
            geo = poly_kml(g["coordinates"])
        parts.append(f"<Placemark><name>{escape(str(p.get('name', 'flood polygon')))}</name>"
                     f"<description>{escape(desc(p))}</description>{geo}</Placemark>")
    parts.append("</Document></kml>")
    with open(os.path.join(OUT, name + ".kml"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts))


save_geojson("settlements", feats_s)
save_geojson("newly_inundated", feats_p)
save_kml("settlements", feats_s, "JalDrishti impacted settlements")
save_kml("newly_inundated", feats_p, "JalDrishti newly inundated (HEC-RAS Plan_03)")

try:
    import geopandas as gpd
    for name, feats in (("settlements", feats_s), ("newly_inundated", feats_p)):
        gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
        gdf.to_file(os.path.join(OUT, name + ".shp"), encoding="utf-8")
    print("shapefiles written")
except ImportError:
    print("geopandas nahi hai -> .shp skip. pip install geopandas")

print(f"settlements: {len(feats_s)} "
      f"(near pool: {sum(f['properties']['near_pool'] for f in feats_s)}) | "
      f"polygons: {len(feats_p)} "
      f"(near pool: {sum(f['properties']['near_pool'] for f in feats_p)})")
print("written ->", OUT)