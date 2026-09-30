# clip_villages.py
import sys
from pathlib import Path
import geopandas as gpd
from shapely.geometry import box

here = Path(__file__).parent
shps = sorted(here.rglob("*.shp"))
if not shps:
    sys.exit(f"{here} mein koi .shp nahi mili. Shapefile yahin extract karo.")
print("using:", shps[0])

g = gpd.read_file(shps[0])
print("columns:", list(g.columns))
g = g.to_crs(4326)
# raster coverage: lon 78-79, lat 30-31, isliye lat 30.0 se clip
g = g[g.intersects(box(78.1, 30.0, 78.7, 30.5))]
g["geometry"] = g.geometry.simplify(0.0002)
g.to_file(here / "villages.geojson", driver="GeoJSON")
print(len(g), "villages")