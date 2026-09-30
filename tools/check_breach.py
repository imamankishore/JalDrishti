import sys
import h5py
import numpy as np

path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\itsam\new_dam_project\new_theri.p02.hdf"
f = h5py.File(path, "r")

hits = []
def visit(name, obj):
    if not isinstance(obj, h5py.Dataset):
        return
    if any(k in name for k in ("Inline", "Breach")) or name.endswith(("Cross Sections/Water Surface", "Cross Sections/Flow")):
        hits.append((name, obj))
f.visititems(visit)

if not hits:
    print("Inline/Breach/XS datasets nahi mile. Structure:")
    f.visit(lambda n: print("  ", n))
    sys.exit(0)

np.set_printoptions(linewidth=200, suppress=True, precision=1)
for name, obj in hits:
    print("\n" + name, obj.shape, obj.dtype)
    try:
        a = np.array(obj, dtype="float64")
    except Exception:
        continue
    if a.size == 0:
        print("   (khaali)")
        continue
    print("   min / max:", np.nanmin(a), "/", np.nanmax(a))
    if a.ndim == 2 and a.shape[0] > 1:
        print("   first col over time:", a[:, 0])
        print("   last  col over time:", a[:, -1])
    else:
        print("   values:", a.ravel()[:30]) 