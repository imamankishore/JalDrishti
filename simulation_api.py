from fastapi import FastAPI, HTTPException
from pathlib import Path
from typing import Optional
import subprocess
import sys
import threading
import time
import uuid
import os
import csv
import glob


# ============================================================
# APP CONFIGURATION
# ============================================================

app = FastAPI(
    title="Flood Simulation Engine",
    description="SPH simulation engine API",
    version="1.5"
)


# ============================================================
# PATH CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

METRICS_FILE = BASE_DIR / "sph_metrics.csv"

GPU_METRICS_FILE = BASE_DIR / "sph_metrics_gpu.csv"

SPH_OUTPUT_DIR = BASE_DIR / "dam_break_2d_output"

GPU_OUTPUT_DIR = BASE_DIR / "dam_break_gpu_api_output"


# ============================================================
# SPH CONFIGURATION
# ============================================================

SPH_MAX_FRAME_TIME = 0.97

SPH_FRAME_COUNT = 60

SPH_GPU_BACKEND = "opencl"

SPH_GPU_NNPS = "gpu_octree"

SPH_GPU_TF = "0.1"

# NVIDIA OpenCL platform
SPH_OPENCL_CONTEXT = "1"


# ============================================================
# GLOBAL JOB STORAGE
# ============================================================

jobs = {}

simulation_lock = threading.Lock()


# ============================================================
# UTILITY FUNCTIONS
# ============================================================

def read_latest_metrics():

    metrics_path = GPU_METRICS_FILE

    if not metrics_path.exists():

        metrics_path = METRICS_FILE

    if not metrics_path.exists():

        return None

    try:

        with open(
            metrics_path,
            "r",
            newline="",
            encoding="utf-8"
        ) as file:

            rows = list(csv.DictReader(file))

        if not rows:
            return None

        row = rows[-1]

        def get_float(name):

            value = row.get(name)

            if value is None or value == "":
                return None

            try:
                return float(value)

            except Exception:
                return None

        return {

            "simulation_time_s":
                get_float("Time_s"),

            "water_front_m":
                get_float("Water_Front_X_m"),

            "particle_height_m":
                get_float("Max_Water_Height_m"),

            "velocity_p95_mps":
                get_float(
                    "Velocity_95th_Percentile_mps"
                ),

            "fluid_particles":
                int(
                    float(
                        row.get(
                            "Fluid_Particles",
                            0
                        )
                    )
                )

        }

    except Exception:

        return None


# ============================================================
# LOAD SPH FRAMES
# ============================================================

def load_sph_frames(
    output_dir: Path,
    max_time: float = SPH_MAX_FRAME_TIME,
    frame_count: int = SPH_FRAME_COUNT
):

    # --------------------------------------------------------
    # GPU and CPU output filenames can have different prefixes.
    # Therefore use all NPZ files.
    # --------------------------------------------------------

    files = glob.glob(
        str(output_dir / "*.npz")
    )

    if not files:

        return []

    frames = []

    # --------------------------------------------------------
    # Sort files by snapshot number
    # --------------------------------------------------------

    def snapshot_number(path):

        try:

            stem = Path(path).stem

            return int(
                stem.split("_")[-1]
            )

        except Exception:

            return 0

    files = sorted(
        files,
        key=snapshot_number
    )

    # --------------------------------------------------------
    # Read snapshots
    # --------------------------------------------------------

    for file_path in files:

        try:

            import numpy as np

            data = np.load(
                file_path,
                allow_pickle=True
            )

            # ------------------------------------------------
            # Solver data
            # ------------------------------------------------

            solver_data = data["solver_data"]

            if hasattr(
                solver_data,
                "item"
            ):

                solver_data = solver_data.item()

            simulation_time = float(
                solver_data.get("t", 0.0)
            )

            # ------------------------------------------------
            # Ignore unstable frames
            # ------------------------------------------------

            if simulation_time > max_time:

                continue

            # ------------------------------------------------
            # Particle dictionary
            # ------------------------------------------------

            particles = data["particles"]

            if hasattr(
                particles,
                "item"
            ):

                particles = particles.item()

            fluid = particles.get("fluid")

            if fluid is None:

                continue

            # ------------------------------------------------
            # Extract arrays
            # ------------------------------------------------

            if hasattr(
                fluid,
                "get"
            ):

                x = fluid.get("x")
                y = fluid.get("y")
                z = fluid.get("z")

            else:

                continue

            if x is None or y is None:

                continue

            x = np.asarray(x)

            y = np.asarray(y)

            # ------------------------------------------------
            # Velocity
            # ------------------------------------------------

            u = fluid.get("u")
            v = fluid.get("v")

            if u is not None and v is not None:

                u = np.asarray(u)

                v = np.asarray(v)

                velocity = np.sqrt(
                    u * u +
                    v * v
                )

                velocity_p95 = float(
                    np.percentile(
                        velocity,
                        95
                    )
                )

            else:

                velocity_p95 = 0.0

            # ------------------------------------------------
            # Frame data
            # ------------------------------------------------

            frame = {

                "time_s":
                    simulation_time,

                "particle_count":
                    int(len(x)),

                "x":
                    x.tolist(),

                "y":
                    y.tolist(),

                "velocity_p95_mps":
                    velocity_p95,

                "water_height_m":
                    float(np.max(y)),

                "water_front_m":
                    float(np.max(x))

            }

            frames.append(frame)

        except Exception:

            continue

    # --------------------------------------------------------
    # Downsample frames
    # --------------------------------------------------------

    if len(frames) > frame_count:

        import numpy as np

        indices = np.linspace(
            0,
            len(frames) - 1,
            frame_count
        ).astype(int)

        frames = [
            frames[i]
            for i in indices
        ]

    return frames


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():

    return {

        "status": "ok",

        "service":
            "flood-simulation-engine",

        "models": [
            "SPH"
        ],

        "gpu":
            "NVIDIA RTX 3050 via OpenCL"

    }


# ============================================================
# LATEST SPH RESULT
# ============================================================

@app.get("/simulation/sph")
def get_latest_sph():

    metrics = read_latest_metrics()

    if metrics is None:

        raise HTTPException(
            status_code=404,
            detail="No SPH metrics available."
        )

    return {

        "status":
            "success",

        "model":
            "SPH",

        "execution":
            "GPU",

        "gpu":
            "NVIDIA GeForce RTX 3050 Laptop GPU",

        **metrics

    }


# ============================================================
# SPH TIME SERIES
# ============================================================

@app.get("/simulation/sph/timeseries")
def get_sph_timeseries():

    metrics_path = GPU_METRICS_FILE

    if not metrics_path.exists():

        metrics_path = METRICS_FILE

    if not metrics_path.exists():

        raise HTTPException(
            status_code=404,
            detail="No SPH metrics file found."
        )

    try:

        with open(
            metrics_path,
            "r",
            newline="",
            encoding="utf-8"
        ) as file:

            rows = list(
                csv.DictReader(file)
            )

        records = []

        for row in rows:

            try:

                records.append({

                    "time_s":
                        float(
                            row["Time_s"]
                        ),

                    "water_height_m":
                        float(
                            row[
                                "Max_Water_Height_m"
                            ]
                        ),

                    "velocity_p95_mps":
                        float(
                            row[
                                "Velocity_95th_Percentile_mps"
                            ]
                        ),

                    "water_front_m":
                        float(
                            row[
                                "Water_Front_X_m"
                            ]
                        ),

                    "fluid_particles":
                        int(
                            float(
                                row[
                                    "Fluid_Particles"
                                ]
                            )
                        )

                })

            except Exception:

                continue

        return {

            "status":
                "success",

            "execution":
                "GPU",

            "gpu":
                "NVIDIA GeForce RTX 3050 Laptop GPU",

            "count":
                len(records),

            "data":
                records

        }

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# ============================================================
# RUN GPU SPH JOB
# ============================================================

def run_sph_job(job_id: str):

    acquired = False

    try:

        # ----------------------------------------------------
        # Acquire simulation lock
        # ----------------------------------------------------

        simulation_lock.acquire()

        acquired = True

        jobs[job_id]["status"] = "running"

        jobs[job_id]["started_at"] = time.time()

        # ----------------------------------------------------
        # Create GPU output directory
        # ----------------------------------------------------

        GPU_OUTPUT_DIR.mkdir(
            parents=True,
            exist_ok=True
        )

        # ----------------------------------------------------
        # Remove old GPU snapshots
        # ----------------------------------------------------

        for old_file in GPU_OUTPUT_DIR.glob("*.npz"):

            try:

                old_file.unlink()

            except Exception:

                pass

        # ----------------------------------------------------
        # NVIDIA OpenCL environment
        # ----------------------------------------------------

        gpu_env = os.environ.copy()

        gpu_env[
            "PYOPENCL_CTX"
        ] = SPH_OPENCL_CONTEXT

        # ----------------------------------------------------
        # GPU PySPH command
        # ----------------------------------------------------

        command = [

            "pysph",

            "run",

            "dam_break_2d",

            "--opencl",

            "--nnps",
            SPH_GPU_NNPS,

            "--tf",
            SPH_GPU_TF,

            "-o",
            "dam_break_gpu_api",

            "-d",
            str(GPU_OUTPUT_DIR)

        ]

        jobs[job_id][
            "command"
        ] = command

        jobs[job_id][
            "execution"
        ] = "GPU"

        jobs[job_id][
            "gpu"
        ] = (
            "NVIDIA GeForce RTX 3050 Laptop GPU"
        )

        # ----------------------------------------------------
        # Start PySPH process
        # ----------------------------------------------------

        process = subprocess.Popen(

            command,

            cwd=BASE_DIR,

            stdout=subprocess.PIPE,

            stderr=subprocess.STDOUT,

            text=True,

            env=gpu_env

        )

        jobs[job_id][
            "process_id"
        ] = process.pid

        output = []

        # ----------------------------------------------------
        # Capture output
        # ----------------------------------------------------

        if process.stdout:

            for line in process.stdout:

                output.append(line)

        # ----------------------------------------------------
        # Wait for process
        # ----------------------------------------------------

        return_code = process.wait()

        jobs[job_id][
            "return_code"
        ] = return_code

        jobs[job_id][
            "output"
        ] = (
            "".join(output)[-10000:]
        )

        # ----------------------------------------------------
        # PySPH failed
        # ----------------------------------------------------

        if return_code != 0:

            jobs[job_id][
                "status"
            ] = "failed"

            jobs[job_id][
                "error"
            ] = (
                "PySPH GPU simulation failed."
            )

            return

        # ----------------------------------------------------
        # Check snapshots
        # ----------------------------------------------------

        snapshot_files = list(
            GPU_OUTPUT_DIR.glob("*.npz")
        )

        if not snapshot_files:

            jobs[job_id][
                "status"
            ] = "failed"

            jobs[job_id][
                "error"
            ] = (
                "GPU simulation completed "
                "but no SPH snapshots were generated."
            )

            return

        jobs[job_id][
            "snapshot_count"
        ] = len(snapshot_files)

        # ----------------------------------------------------
        # Generate GPU metrics
        # ----------------------------------------------------

        metrics_process = subprocess.run(

            [

                sys.executable,

                "sph_metrics.py",

                "--input",
                str(GPU_OUTPUT_DIR),

                "--output",
                str(GPU_METRICS_FILE),

                "--max-time",
                str(SPH_MAX_FRAME_TIME)

            ],

            cwd=BASE_DIR,

            capture_output=True,

            text=True,

            env=gpu_env

        )

        jobs[job_id][
            "metrics_output"
        ] = (
            metrics_process.stdout[-10000:]
        )

        # ----------------------------------------------------
        # Metrics failed
        # ----------------------------------------------------

        if metrics_process.returncode != 0:

            jobs[job_id][
                "status"
            ] = "failed"

            jobs[job_id][
                "metrics_error"
            ] = (
                metrics_process.stderr[-10000:]
            )

            return

        # ----------------------------------------------------
        # Verify metrics file
        # ----------------------------------------------------

        if not GPU_METRICS_FILE.exists():

            jobs[job_id][
                "status"
            ] = "failed"

            jobs[job_id][
                "metrics_error"
            ] = (
                "sph_metrics.py completed "
                "but GPU metrics file was not created."
            )

            return

        # ----------------------------------------------------
        # Load latest metrics
        # ----------------------------------------------------

        metrics = read_latest_metrics()

        if metrics is None:

            jobs[job_id][
                "status"
            ] = "failed"

            jobs[job_id][
                "metrics_error"
            ] = (
                "GPU metrics file exists "
                "but could not be read."
            )

            return

        jobs[job_id][
            "metrics"
        ] = metrics

        # ----------------------------------------------------
        # Load particle frames
        # ----------------------------------------------------

        frames = load_sph_frames(
            GPU_OUTPUT_DIR,
            max_time=SPH_MAX_FRAME_TIME,
            frame_count=SPH_FRAME_COUNT
        )

        jobs[job_id][
            "frames"
        ] = frames

        # ----------------------------------------------------
        # FINAL SUCCESS
        # ----------------------------------------------------

        jobs[job_id][
            "status"
        ] = "completed"

        jobs[job_id][
            "message"
        ] = (
            "GPU SPH simulation completed successfully."
        )

    except Exception as error:

        jobs[job_id][
            "status"
        ] = "failed"

        jobs[job_id][
            "error"
        ] = str(error)

    finally:

        if acquired:

            simulation_lock.release()

        jobs[job_id][
            "finished_at"
        ] = time.time()


# ============================================================
# START SPH SIMULATION
# ============================================================

@app.post("/simulation/sph/run")
def start_sph_simulation():

    # --------------------------------------------------------
    # Prevent multiple simultaneous simulations
    # --------------------------------------------------------

    if not simulation_lock.acquire(
        blocking=False
    ):

        raise HTTPException(

            status_code=409,

            detail=(
                "Another SPH simulation "
                "is already running."
            )

        )

    # --------------------------------------------------------
    # Immediately release.
    #
    # The background worker will acquire it again.
    # --------------------------------------------------------

    simulation_lock.release()

    # --------------------------------------------------------
    # Create job
    # --------------------------------------------------------

    job_id = str(
        uuid.uuid4()
    )

    jobs[job_id] = {

        "job_id":
            job_id,

        "status":
            "accepted",

        "execution":
            "GPU",

        "gpu":
            "NVIDIA GeForce RTX 3050 Laptop GPU",

        "created_at":
            time.time()

    }

    # --------------------------------------------------------
    # Start background thread
    # --------------------------------------------------------

    thread = threading.Thread(

        target=run_sph_job,

        args=(job_id,),

        daemon=True

    )

    thread.start()

    return {

        "status":
            "accepted",

        "message":
            "GPU SPH simulation started",

        "job_id":
            job_id,

        "execution":
            "GPU",

        "gpu":
            "NVIDIA GeForce RTX 3050 Laptop GPU"

    }


# ============================================================
# JOB STATUS
# ============================================================

@app.get("/simulation/status/{job_id}")
def get_simulation_status(
    job_id: str
):

    job = jobs.get(job_id)

    if job is None:

        raise HTTPException(

            status_code=404,

            detail="Simulation job not found."

        )

    return {

        "job_id":
            job_id,

        "status":
            job.get("status"),

        "execution":
            job.get("execution"),

        "gpu":
            job.get("gpu"),

        "process_id":
            job.get("process_id"),

        "return_code":
            job.get("return_code"),

        "snapshot_count":
            job.get("snapshot_count"),

        "error":
            job.get("error"),

        "metrics_error":
            job.get("metrics_error"),

        "created_at":
            job.get("created_at"),

        "started_at":
            job.get("started_at"),

        "finished_at":
            job.get("finished_at")

    }


# ============================================================
# SIMULATION RESULT
# ============================================================

@app.get("/simulation/result/{job_id}")
def get_simulation_result(
    job_id: str
):

    job = jobs.get(job_id)

    if job is None:

        raise HTTPException(

            status_code=404,

            detail="Simulation job not found."

        )

    # --------------------------------------------------------
    # Failed
    # --------------------------------------------------------

    if job.get("status") == "failed":

        return {

            "job_id":
                job_id,

            "status":
                "failed",

            "message":
                "Simulation failed.",

            "error":
                job.get("error"),

            "metrics_error":
                job.get("metrics_error")

        }

    # --------------------------------------------------------
    # Still running
    # --------------------------------------------------------

    if job.get("status") != "completed":

        return {

            "job_id":
                job_id,

            "status":
                job.get("status"),

            "message":
                "Simulation result is not ready yet."

        }

    # --------------------------------------------------------
    # Completed
    # --------------------------------------------------------

    metrics = job.get("metrics")

    if metrics is None:

        metrics = read_latest_metrics()

    frames = job.get(
        "frames",
        []
    )

    return {

        "job_id":
            job_id,

        "status":
            "completed",

        "execution":
            "GPU",

        "gpu":
            "NVIDIA GeForce RTX 3050 Laptop GPU",

        "metrics":
            metrics,

        "frames":
            frames,

        "snapshot_count":
            job.get(
                "snapshot_count",
                len(frames)
            ),

        "model":
            "SPH",

        "model_notes": [

            "SPH simulation executed using PySPH OpenCL backend.",

            "GPU execution uses NVIDIA GeForce RTX 3050 Laptop GPU.",

            "Particle frames represent the available particle-based dam-break benchmark output.",

            "These SPH benchmark particles are not georeferenced Tehri inundation results."

        ]

    }


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {

        "service":
            "Flood Simulation Engine",

        "version":
            "1.5",

        "status":
            "running",

        "engine":
            "SPH",

        "execution":
            "GPU",

        "gpu":
            "NVIDIA GeForce RTX 3050 Laptop GPU",

        "backend":
            "OpenCL",

        "nnps":
            "gpu_octree"

    }