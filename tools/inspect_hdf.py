# tools\inspect_hdf.py  (JalDrishti root se: python tools\inspect_hdf.py)
import h5py, numpy as np

P = r"C:\Users\itsam\new_dam_project\new_theri.p03.hdf"
DAM = (257897.0, 3363343.0)     # UTM 44N, dam
f = h5py.File(P, "r")

# ---- 1. poora tree file mein ----
lines = []
f.visititems(lambda n, o: lines.append(f"{n}  {o.shape} {o.dtype}") if isinstance(o, h5py.Dataset) else None)
with open("tools/hdf_tree.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))
print(len(lines), "datasets -> tools/hdf_tree.txt")


def show_attrs(path):
    if path in f:
        for k, v in f[path].attrs.items():
            if isinstance(v, bytes):
                v = v.decode("utf-8", "ignore")
            print(f"  [{path}] {k} = {str(v)[:120]}")


print("\n--- attrs (units/version) ---")
for p in ["/", "Geometry", "Plan Data/Plan Information", "Results/Unsteady"]:
    show_attrs(p)

# ---- 2. 2D area dhundo ----
geo = f["Geometry/2D Flow Areas"]
areas = [k for k in geo.keys() if isinstance(geo[k], h5py.Group) and "Cells Center Coordinate" in geo[k]]
print("\n2D areas:", areas)
A = areas[0]
g = geo[A]
xy = g["Cells Center Coordinate"][:]
zmin = g["Cells Minimum Elevation"][:]
area = g["Cells Surface Area"][:] if "Cells Surface Area" in g else np.full(len(zmin), 75.0 * 75.0)
print("cells:", len(zmin), "| x range", xy[:, 0].min(), xy[:, 0].max(), "| y range", xy[:, 1].min(), xy[:, 1].max())
print("terrain min/max elev:", float(zmin.min()), float(zmin.max()))

base = "Results/Unsteady/Output/Output Blocks/Base Output"
ts = f[f"{base}/Unsteady Time Series"]
print("\ntime series keys:", list(ts.keys()))
print("2D keys:", list(ts[f"2D Flow Areas/{A}"].keys()))

# ---- 3. max depth ----
try:
    mx = f[f"{base}/Summary Output/2D Flow Areas/{A}/Maximum Water Surface"][0]
    d = np.clip(mx - zmin, 0, None)
    wet = d > 0.05
    dist = np.hypot(xy[:, 0] - DAM[0], xy[:, 1] - DAM[1]) / 1000
    print(f"\nMAX depth: {d.max():.1f} m | wet cells {wet.sum()} | wet area {(area[wet].sum()/1e6):.1f} km2")
    print("depth percentiles (wet) 50/90/99:", np.percentile(d[wet], [50, 90, 99]).round(1))
    print(f"farthest wet cell from dam: {dist[wet].max():.1f} km (Rishikesh ~40 km)")
    for lo, hi in [(0, 5), (5, 10), (10, 20), (20, 40), (40, 100)]:
        m = wet & (dist >= lo) & (dist < hi)
        print(f"  {lo:>3}-{hi:<3} km: wet {m.sum():6d} cells, max depth {d[m].max() if m.any() else 0:6.1f} m")
except Exception as e:
    print("max depth skip:", e)

# ---- 4. volume vs time ----
try:
    ws = ts[f"2D Flow Areas/{A}/Water Surface"]
    t = ts["Time"][:] if "Time" in ts else np.arange(ws.shape[0])
    print("\nWater Surface shape:", ws.shape, "| time unit sample:", t[:3], "...", t[-1])
    step = max(1, ws.shape[0] // 12)
    print("  step | wet km2 | volume m3 | max depth m")
    for i in range(0, ws.shape[0], step):
        di = np.clip(ws[i] - zmin, 0, None)
        print(f"  {i:4d} | {area[di > 0.05].sum()/1e6:7.1f} | {(di * area).sum():.3e} | {di.max():7.1f}")
except Exception as e:
    print("time series skip:", e)