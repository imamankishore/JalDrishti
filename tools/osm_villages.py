# tools\osm_villages.py
import requests, geopandas as gpd
from pathlib import Path
from shapely.geometry import Point

Q = """[out:json][timeout:120];
node["place"~"^(village|hamlet|town|suburb)$"](30.0,78.1,30.5,78.7);
out body;"""
r = requests.post("https://overpass-api.de/api/interpreter", data={"data": Q},
                  headers={"User-Agent": "JalDrishti-SIH/1.0"}, timeout=180)
r.raise_for_status()
els = r.json()["elements"]
g = gpd.GeoDataFrame(
    [{"name": e.get("tags", {}).get("name", f"node_{e['id']}"),
      "place": e["tags"].get("place"), "geometry": Point(e["lon"], e["lat"])} for e in els],
    crs=4326)
g["geometry"] = g.to_crs(32644).buffer(300).to_crs(4326)   # ~300 m settlement footprint
out = Path(__file__).parent / "villages.geojson"
g.to_file(out, driver="GeoJSON")
print(len(g), "settlements ->", out)