# tools\make_2d_inputs.py  (JalDrishti root se: python tools\make_2d_inputs.py)
import os
import geopandas as gpd
from pyproj import CRS, Transformer
from shapely.geometry import Polygon

OUT = r"C:\Users\itsam\new_dam_project\gis_inputs"
os.makedirs(OUT, exist_ok=True)
utm = CRS.from_epsg(32644)                       # WGS 84 / UTM 44N

# 1) HEC-RAS ke liye projection file
with open(os.path.join(OUT, "utm44n.prj"), "w") as f:
    f.write(utm.to_wkt(version="WKT1_ESRI"))

# 2) 2D flow area perimeter (tumhara 6-vertex polygon), UTM mein
verts = [
    ("top-left",     78.450, 30.400),
    ("top-right",    78.506, 30.394),
    ("Devprayag",    78.602, 30.145),
    ("Rishikesh-S",  78.276, 30.071),
    ("Rishikesh-N",  78.230, 30.120),
    ("mid-west",     78.554, 30.169),
]
poly = gpd.GeoSeries([Polygon([(x, y) for _, x, y in verts])], crs=4326).to_crs(utm)
gpd.GeoDataFrame({"Name": ["Tehri2D"]}, geometry=poly).to_file(
    os.path.join(OUT, "Tehri2D_perimeter.shp"))

# 3) click karne ke liye UTM coordinates (RAS Mapper ke status bar mein yahi dikhenge)
to_utm = Transformer.from_crs(4326, utm, always_xy=True)
print("Polygon area: %.0f km2" % (poly.area.iloc[0] / 1e6))
print("Dam (78.4806, 30.3778) UTM:", [round(v) for v in to_utm.transform(78.4806, 30.3778)])
for name, x, y in verts:
    ex, ny = to_utm.transform(x, y)
    print(f"{name:12} UTM x={ex:9.0f} y={ny:9.0f}")
print("\nfiles ->", OUT)