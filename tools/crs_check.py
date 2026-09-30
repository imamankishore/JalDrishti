# crs_check.py
import glob, numpy as np, rasterio
f = sorted(glob.glob(r"server/data/rasters/**/*.tif", recursive=True))[0]
with rasterio.open(f) as r:
    print(f, r.crs, r.bounds, r.res)
for p in glob.glob(r"C:\Users\itsam\OneDrive\Desktop\New folder (2)\*terrain*.npy"):
    a = np.load(p); print(p, a.shape, a[..., :2].min(0).min(0) if a.ndim > 1 else a.min(), a.max())