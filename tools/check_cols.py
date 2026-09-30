import h5py, numpy as np
np.set_printoptions(linewidth=200, suppress=True, precision=2)
f = h5py.File(r"C:\Users\itsam\new_dam_project\new_theri.p02.hdf", "r")
base = "Results/Unsteady/Output/Output Blocks/DSS Hydrograph Output/Unsteady Time Series/Inline Structures/Ganga UpperReach 3.999/"
for n in ("Breaching Variables", "Structure Variables"):
    d = f[base + n]
    print("\n" + n, d.shape, {k: d.attrs[k] for k in d.attrs})
    print(np.array(d)[:6])
parent = f[base]
print("\nparent attrs:", {k: parent.attrs[k] for k in parent.attrs})