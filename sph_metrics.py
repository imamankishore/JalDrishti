import numpy as np
import glob
import os
import csv
import argparse


# ============================================================
# ARGUMENTS
# ============================================================

parser = argparse.ArgumentParser(
    description="Generate SPH metrics from PySPH output."
)

parser.add_argument(
    "--input",
    default="dam_break_2d_output",
    help="Folder containing PySPH .npz snapshots"
)

parser.add_argument(
    "--output",
    default="sph_metrics.csv",
    help="Output CSV path"
)

parser.add_argument(
    "--max-time",
    type=float,
    default=0.95,
    help="Maximum stable simulation time in seconds"
)

args = parser.parse_args()


# ============================================================
# FIND SNAPSHOTS
# ============================================================

pattern = os.path.join(
    args.input,
    "*.npz"
)

files = glob.glob(pattern)


# ------------------------------------------------------------
# Keep only PySPH snapshot files
# ------------------------------------------------------------

files = [
    file_path
    for file_path in files
    if os.path.basename(file_path).lower().endswith(".npz")
]


# ------------------------------------------------------------
# Sort by snapshot number
# ------------------------------------------------------------

def snapshot_number(file_path):

    filename = os.path.basename(file_path)

    try:

        number = filename.split("_")[-1].split(".")[0]

        return int(number)

    except ValueError:

        return 0


files = sorted(
    files,
    key=snapshot_number
)


if not files:

    raise FileNotFoundError(
        f"No SPH snapshot files found in: {args.input}"
    )


# ============================================================
# PROCESS SNAPSHOTS
# ============================================================

rows = []

for file_path in files:

    try:

        f = np.load(
            file_path,
            allow_pickle=True
        )

        # ----------------------------------------------------
        # Solver data
        # ----------------------------------------------------

        solver = f[
            "solver_data"
        ].item()

        t = float(
            solver["t"]
        )

        # ----------------------------------------------------
        # Stable region only
        # ----------------------------------------------------

        if t > args.max_time:

            f.close()

            continue

        # ----------------------------------------------------
        # Particle data
        # ----------------------------------------------------

        particles = f[
            "particles"
        ].item()

        fluid = particles[
            "fluid"
        ][
            "arrays"
        ]

        x = np.asarray(
            fluid["x"],
            dtype=np.float64
        )

        y = np.asarray(
            fluid["y"],
            dtype=np.float64
        )

        u = np.asarray(
            fluid["u"],
            dtype=np.float64
        )

        v = np.asarray(
            fluid["v"],
            dtype=np.float64
        )

        # ----------------------------------------------------
        # Velocity magnitude
        # ----------------------------------------------------

        velocity = np.sqrt(
            u ** 2 + v ** 2
        )

        # ----------------------------------------------------
        # 95th percentile velocity
        # ----------------------------------------------------

        velocity_95 = float(
            np.percentile(
                velocity,
                95
            )
        )

        # ----------------------------------------------------
        # Water height
        # ----------------------------------------------------

        max_height = float(
            np.max(y)
        )

        # ----------------------------------------------------
        # Water front
        # ----------------------------------------------------

        water_front = float(
            np.max(x)
        )

        # ----------------------------------------------------
        # Particle count
        # ----------------------------------------------------

        particle_count = len(x)

        # ----------------------------------------------------
        # Store row
        # ----------------------------------------------------

        rows.append([

            t,

            max_height,

            velocity_95,

            water_front,

            particle_count

        ])

        f.close()

    except Exception as error:

        print(
            f"Warning: failed to process "
            f"{os.path.basename(file_path)}"
        )

        print(
            f"Reason: {error}"
        )

        continue


# ============================================================
# VALIDATION
# ============================================================

if not rows:

    raise RuntimeError(
        "No stable SPH snapshots were successfully processed."
    )


# ============================================================
# SAVE METRICS
# ============================================================

with open(
    args.output,
    "w",
    newline=""
) as f:

    writer = csv.writer(f)

    writer.writerow([

        "Time_s",

        "Max_Water_Height_m",

        "Velocity_95th_Percentile_mps",

        "Water_Front_X_m",

        "Fluid_Particles"

    ])

    writer.writerows(
        rows
    )


# ============================================================
# SUMMARY
# ============================================================

print()

print("================================")
print("CLEAN SPH METRICS GENERATED")
print("================================")

print(
    f"Input folder: {args.input}"
)

print(
    f"Snapshots found: {len(files)}"
)

print(
    f"Snapshots processed: {len(rows)}"
)

print(
    f"Maximum stable time: {args.max_time}s"
)

print(
    f"Saved: {args.output}"
)

print()

print("Last 5 stable measurements:")

for row in rows[-5:]:

    print(

        f"t={row[0]:.3f}s | "

        f"height={row[1]:.3f}m | "

        f"velocity(P95)="
        f"{row[2]:.3f}m/s | "

        f"front={row[3]:.3f}m"

    )

print()