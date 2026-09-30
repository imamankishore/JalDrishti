import os
import sys
import numpy as np

from pysph.base.utils import get_particle_array
from pysph.base.nnps import LinkedListNNPS
from pysph.base.nnps_base import DomainManager
from pysph.solver.application import Application
from pysph.solver.solver import Solver
from pysph.sph.integrator import Integrator
from pysph.sph.integrator_step import WCSPHStep
from pysph.sph.scheme import WCSPHScheme


# ============================================================
# CONFIG
# ============================================================

BASE_DIR = r"C:\Users\itsam\OneDrive\Desktop\New folder (2)"

TERRAIN_DIR = os.path.join(BASE_DIR, "terrain")

FLUID_FILE = os.path.join(
    TERRAIN_DIR,
    "tehri_sph_initial_particles_14m.npy"
)

# Fallback test fluid file
if not os.path.exists(FLUID_FILE):
    FLUID_FILE = os.path.join(
        TERRAIN_DIR,
        "tehri_sph_initial_particles_test.npy"
    )

TERRAIN_FILE = os.path.join(
    TERRAIN_DIR,
    "tehri_sph_floodcorridor_terrain.npy"
)

DAM_FILE = os.path.join(
    TERRAIN_DIR,
    "tehri_sph_dam_boundary_breach20m.npy"
)


# ============================================================
# GPU / OPENCL
# ============================================================

# NVIDIA OpenCL context
os.environ["PYOPENCL_CTX"] = "1"


# ============================================================
# SPH PARAMETERS
# ============================================================

DX = 14.25

HDX = 1.3
H = HDX * DX

RHO0 = 1000.0
C0 = 10.0

G = 9.81


# ============================================================
# SIMULATION DEFAULTS
# ============================================================

DT = 0.0005
TF = 0.02


# ============================================================
# OUTPUT
# ============================================================

OUTPUT_DIR = os.path.join(
    BASE_DIR,
    "tehri_gpu_full_output"
)


# ============================================================
# HEADER
# ============================================================

print("=" * 75)
print("JALDRISHTI - TEHRI 3D GPU SPH")
print("FLUID + TERRAIN + 20m BREACH DAM")
print("=" * 75)


# ============================================================
# INPUT FILE CHECK
# ============================================================

print("\nChecking input files...")

for label, path in [
    ("FLUID", FLUID_FILE),
    ("TERRAIN", TERRAIN_FILE),
    ("DAM", DAM_FILE),
]:

    print(f"{label:8s}: {path}")

    if not os.path.exists(path):
        raise FileNotFoundError(
            f"\nMissing {label} file:\n{path}"
        )

print("\nAll input files found.")


# ============================================================
# LOAD PARTICLES
# ============================================================

print("\n" + "=" * 75)
print("LOADING PARTICLES")
print("=" * 75)

fluid_xyz = np.load(FLUID_FILE).astype(np.float64)
terrain_xyz = np.load(TERRAIN_FILE).astype(np.float64)
dam_xyz = np.load(DAM_FILE).astype(np.float64)

print("\nOriginal particle counts:")

print("Fluid   :", len(fluid_xyz))
print("Terrain :", len(terrain_xyz))
print("Dam     :", len(dam_xyz))

print(
    "Total   :",
    len(fluid_xyz)
    + len(terrain_xyz)
    + len(dam_xyz)
)


# ============================================================
# VALIDATE INPUT SHAPES
# ============================================================

for name, arr in [
    ("fluid", fluid_xyz),
    ("terrain", terrain_xyz),
    ("dam", dam_xyz),
]:

    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ValueError(
            f"{name} must have shape (N, 3), "
            f"got {arr.shape}"
        )


# ============================================================
# NaN / INF CHECK
# ============================================================

for name, arr in [
    ("fluid", fluid_xyz),
    ("terrain", terrain_xyz),
    ("dam", dam_xyz),
]:

    n_nan = int(np.isnan(arr).sum())
    n_inf = int(np.isinf(arr).sum())

    if n_nan or n_inf:
        raise ValueError(
            f"{name} contains NaN={n_nan} Inf={n_inf} values"
        )


# ============================================================
# DEDUPE
# ============================================================

def dedupe(arr, tol=1e-6):

    rounded = np.round(arr / tol) * tol

    _, idx = np.unique(
        rounded,
        axis=0,
        return_index=True
    )

    return arr[np.sort(idx)]


print("\n" + "=" * 75)
print("DEDUPE CHECK")
print("=" * 75)

n_fluid_before = len(fluid_xyz)
n_terrain_before = len(terrain_xyz)
n_dam_before = len(dam_xyz)

fluid_xyz = dedupe(fluid_xyz)
terrain_xyz = dedupe(terrain_xyz)
dam_xyz = dedupe(dam_xyz)

print(
    f"Fluid   : removed "
    f"{n_fluid_before - len(fluid_xyz)} duplicates"
)

print(
    f"Terrain : removed "
    f"{n_terrain_before - len(terrain_xyz)} duplicates"
)

print(
    f"Dam     : removed "
    f"{n_dam_before - len(dam_xyz)} duplicates"
)


# ============================================================
# CROSS ARRAY COINCIDENCE CHECK
# ============================================================

all_pts = np.vstack([
    fluid_xyz,
    terrain_xyz,
    dam_xyz
])

n_all = len(all_pts)

n_all_unique = len(
    np.unique(
        np.round(all_pts / 1e-6) * 1e-6,
        axis=0
    )
)

print(
    f"Cross-array coincident points: "
    f"{n_all - n_all_unique} "
    f"(dam/terrain/fluid points sharing the same location)"
)


# ============================================================
# COMMON COORDINATE SHIFT
# ============================================================

all_xyz = np.vstack([
    fluid_xyz,
    terrain_xyz,
    dam_xyz
])

origin = all_xyz.mean(axis=0)

print("\nCommon coordinate origin:")
print("X0:", float(origin[0]))
print("Y0:", float(origin[1]))
print("Z0:", float(origin[2]))

fluid_xyz -= origin
terrain_xyz -= origin
dam_xyz -= origin


# ============================================================
# COORDINATE REPORT
# ============================================================

print("\n" + "=" * 75)
print("COORDINATE RANGES AFTER COMMON SHIFT")
print("=" * 75)

for name, arr in [
    ("FLUID", fluid_xyz),
    ("TERRAIN", terrain_xyz),
    ("DAM", dam_xyz),
]:

    print(f"\n{name}")

    print(
        "X:",
        float(arr[:, 0].min()),
        "to",
        float(arr[:, 0].max())
    )

    print(
        "Y:",
        float(arr[:, 1].min()),
        "to",
        float(arr[:, 1].max())
    )

    print(
        "Z:",
        float(arr[:, 2].min()),
        "to",
        float(arr[:, 2].max())
    )


# ============================================================
# FLUID PROPERTIES
# ============================================================

fx = fluid_xyz[:, 0]
fy = fluid_xyz[:, 1]
fz = fluid_xyz[:, 2]

nf = len(fx)

fluid_rho = np.full(nf, RHO0, dtype=np.float64)
fluid_rho0 = np.full(nf, RHO0, dtype=np.float64)
fluid_mass = np.full(nf, RHO0 * DX**3, dtype=np.float64)
fluid_h = np.full(nf, H, dtype=np.float64)
fluid_cs = np.full(nf, C0, dtype=np.float64)
fluid_dt_cfl = np.full(nf, DT, dtype=np.float64)
fluid_dt_force = np.full(nf, DT, dtype=np.float64)
fluid_ax = np.zeros(nf, dtype=np.float64)
fluid_ay = np.zeros(nf, dtype=np.float64)
fluid_az = np.zeros(nf, dtype=np.float64)
fluid_arho = np.zeros(nf, dtype=np.float64)


# ============================================================
# TERRAIN PROPERTIES
# ============================================================

tx = terrain_xyz[:, 0]
ty = terrain_xyz[:, 1]
tz = terrain_xyz[:, 2]

nt = len(tx)

terrain_rho = np.full(nt, RHO0, dtype=np.float64)
terrain_mass = np.full(nt, RHO0 * DX**3, dtype=np.float64)
terrain_h = np.full(nt, H, dtype=np.float64)


# ============================================================
# DAM PROPERTIES
# ============================================================

dx = dam_xyz[:, 0]
dy = dam_xyz[:, 1]
dz = dam_xyz[:, 2]

nd = len(dx)

dam_rho = np.full(nd, RHO0, dtype=np.float64)
dam_mass = np.full(nd, RHO0 * DX**3, dtype=np.float64)
dam_h = np.full(nd, H, dtype=np.float64)


# ============================================================
# CREATE FLUID
# ============================================================

fluid = get_particle_array(
    name="fluid",
    x=fx, y=fy, z=fz,
    m=fluid_mass,
    rho=fluid_rho,
    rho0=fluid_rho0,
    h=fluid_h,
    cs=fluid_cs,
    dt_cfl=fluid_dt_cfl,
    dt_force=fluid_dt_force,
    ax=fluid_ax,
    ay=fluid_ay,
    az=fluid_az,
    arho=fluid_arho
)


# ============================================================
# CREATE TERRAIN
# ============================================================

terrain = get_particle_array(
    name="terrain",
    x=tx, y=ty, z=tz,
    m=terrain_mass,
    rho=terrain_rho,
    h=terrain_h
)


# ============================================================
# CREATE DAM
# ============================================================

dam = get_particle_array(
    name="dam",
    x=dx, y=dy, z=dz,
    m=dam_mass,
    rho=dam_rho,
    h=dam_h
)


# ============================================================
# PARTICLE COUNTS
# ============================================================

print("\n" + "=" * 75)
print("PYSPH PARTICLE ARRAYS")
print("=" * 75)

print("Fluid   :", fluid.get_number_of_particles())
print("Terrain :", terrain.get_number_of_particles())
print("Dam     :", dam.get_number_of_particles())

total_particles = (
    fluid.get_number_of_particles()
    + terrain.get_number_of_particles()
    + dam.get_number_of_particles()
)

print("---------------------------")
print("TOTAL   :", total_particles)


# ============================================================
# WCSPH SCHEME
# ============================================================

scheme = WCSPHScheme(
    fluids=["fluid"],
    solids=["terrain", "dam"],
    dim=3,
    rho0=RHO0,
    c0=C0,
    h0=H,
    hdx=HDX,
    gamma=7.0,
    gx=0.0,
    gy=0.0,
    gz=-G,
    alpha=0.1,
    beta=0.0,
    delta=0.1,
    nu=0.0,
    tensile_correction=False,
    hg_correction=False,
    update_h=False,
    delta_sph=False,
    summation_density=True
)


# ============================================================
# DISABLE XSPH
# ============================================================

if hasattr(scheme, "xsph"):
    scheme.xsph = False


# ============================================================
# SETUP SCHEME PROPERTIES
# ============================================================

scheme.setup_properties([fluid, terrain, dam])


# ============================================================
# VERIFY FLUID PROPERTIES
# ============================================================

print("\n" + "=" * 75)
print("FLUID PROPERTY CHECK")
print("=" * 75)

required_fluid_properties = [
    "h", "cs", "rho0", "dt_cfl", "dt_force",
    "ax", "ay", "az", "arho",
]

for prop in required_fluid_properties:

    if not hasattr(fluid, prop):
        raise RuntimeError(
            f"Fluid is missing required property: {prop}"
        )

    print(f"{prop:10s}: OK")


# ============================================================
# VERIFY SOLID PROPERTIES
# ============================================================

print("\n" + "=" * 75)
print("SOLID PROPERTY CHECK")
print("=" * 75)

print("Terrain h:", float(terrain.h.min()), "to", float(terrain.h.max()))
print("Dam h    :", float(dam.h.min()), "to", float(dam.h.max()))


# ============================================================
# SAFETY CHECK
# ============================================================

if np.any(fluid.h <= 0):
    raise RuntimeError("Fluid h contains zero/negative values.")

if np.any(terrain.h <= 0):
    raise RuntimeError("Terrain h contains zero/negative values.")

if np.any(dam.h <= 0):
    raise RuntimeError("Dam h contains zero/negative values.")

print("\nAll particle-property checks PASSED.")


# ============================================================
# SOLVER
# ============================================================

solver = Solver(
    dim=3,
    integrator=Integrator(fluid=WCSPHStep()),
    dt=DT,
    tf=TF
)


# ============================================================
# APPLICATION
# ============================================================

class TehriFullGPU(Application):

    def create_particles(self):
        return [fluid, terrain, dam]

    def create_solver(self):
        return solver

    def create_scheme(self):
        return scheme

    # --------------------------------------------------------
    # IMPORTANT:
    # Explicitly create the classical linked-list NNPS,
    # with a CPU-backed DomainManager.
    #
    # The --opencl flag makes PySPH default to a GPU domain
    # manager for ANY NNPS class, including LinkedListNNPS.
    # That GPU domain manager expects particle arrays to carry
    # a populated `.gpu` device-array wrapper, which plain
    # numpy-backed ParticleArrays here do not have — causing
    # AttributeError: 'NoneType' object has no attribute
    # 'get_device_array' inside gpu_domain_manager.py.
    #
    # Forcing backend="cython" on the DomainManager keeps
    # neighbor search on the CPU while the SPH sums themselves
    # can still run through the OpenCL acceleration backend.
    # --------------------------------------------------------

    def create_nnps(self):

        print("\n" + "=" * 75)
        print("CREATING EXPLICIT NNPS")
        print("=" * 75)

        print("NNPS backend    : LinkedListNNPS")
        print("Domain backend  : cython (CPU, forced)")
        print("Radius scale    : 2.0")
        print("Dimension       : 3")

        domain = DomainManager(
            dim=3,
            backend="cython"
        )

        nnps = LinkedListNNPS(
            dim=3,
            particles=[fluid, terrain, dam],
            radius_scale=2.0,
            cache=False,
            fixed_h=True,
            domain=domain
        )

        print("NNPS created successfully.")

        return nnps


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    # --------------------------------------------------------
    # Parse a custom --tf value manually.
    # --------------------------------------------------------

    tf_value = TF

    if "--tf" in sys.argv:

        try:

            idx = sys.argv.index("--tf")

            if idx + 1 < len(sys.argv):

                tf_value = float(sys.argv[idx + 1])

                solver.tf = tf_value

        except Exception:

            pass

    print("\n" + "=" * 75)
    print("STARTING FULL TEHRI GPU SPH")
    print("=" * 75)

    print("Backend    : OpenCL")
    print("GPU        : NVIDIA GeForce RTX 3050")
    print("NNPS       : Explicit LinkedListNNPS (CPU domain)")
    print("Dimension  : 3D")

    print()

    print("Fluid      :", nf)
    print("Terrain    :", nt)
    print("Dam        :", nd)
    print("Total      :", total_particles)

    print()

    print("Particle spacing :", DX)
    print("Smoothing h      :", H)

    print("Reference rho     :", RHO0)
    print("Sound speed       :", C0)

    print()

    print("dt :", DT)
    print("tf :", tf_value)

    print()

    print("Simulation setup:")
    print("  Reservoir fluid")
    print("  Flood-corridor terrain")
    print("  20 m breach dam boundary")

    print()

    print("IMPORTANT:")
    print("  GPU OpenCL device will be selected by PySPH for SPH sums.")
    print("  NNPS domain is explicitly forced to CPU (cython) backend.")
    print("  GPU Octree/ZOrder NNPS is NOT requested.")

    print("\nLaunching PySPH...\n")

    app = TehriFullGPU()

    app.run()

    print("\n" + "=" * 75)
    print("FULL TEHRI GPU SPH SIMULATION FINISHED")
    print("=" * 75)

    print("\nParticles simulated:")

    print("Fluid   :", nf)
    print("Terrain :", nt)
    print("Dam     :", nd)
    print("Total   :", total_particles)