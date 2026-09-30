# tools\add_arrival.py   usage: python tools\add_arrival.py <arrival.tif> [divisor]
# divisor = 3600 agar raster seconds mein hai, default 1 (hours)
import json, sys
import numpy as np, rasterio, geopandas as gpd
from rasterio.mask import mask

F = sys.argv[1]
DIV = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0

rows = json.load(open("server/data/impact.json", encoding="utf-8"))
vil = gpd.read_file("tools/villages.geojson").reset_index(drop=True)
assert len(rows) == len(vil), "impact.json aur villages.geojson ka order/len match nahi"

with rasterio.open(F) as r:
    vil = vil.to_crs(r.crs)
    nd = r.nodata
    for row, geom in zip(rows, vil.geometry):
        try:
            a, _ = mask(r, [geom], crop=True, filled=False)
            a = np.ma.filled(a[0].astype("float64"), np.nan)
            if nd is not None:
                a[a == nd] = np.nan
            a[a <= 0] = np.nan          # t=0 se gila (river channel/reservoir) hata do
            a = a / DIV
            row["arrivalTimeH"] = round(float(np.nanmin(a)), 2) if np.isfinite(a).any() else None
        except ValueError:
            pass

json.dump(rows, open("server/data/impact.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
vals = [r["arrivalTimeH"] for r in rows if r["arrivalTimeH"] is not None]
print(len(vals), "settlements with arrival; range", min(vals), "-", max(vals), "h")