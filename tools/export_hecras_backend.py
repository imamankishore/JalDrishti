# tools/export_hecras_backend.py
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import h5py
import numpy as np

try:
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import calculate_default_transform, reproject, Resampling
except ImportError as exc:
    raise SystemExit("rasterio is required. Run: python -m pip install rasterio") from exc

ROOT = Path(__file__).resolve().parents[1]
HDF_PATH = Path(os.getenv("HECRAS_HDF_PATH", r"C:\Users\itsam\new_dam_project\new_theri.p03.hdf"))
OUT_DIR = ROOT / "server" / "data" / "rasters" / "tehri_2d"
UTM_DIR = OUT_DIR / "_utm"
MANIFEST_PATH = OUT_DIR / "manifest.json"
SOURCE_CRS = "EPSG:32644"
TARGET_CRS = "EPSG:4326"
AREA_NAME = "Tehri2D (1)"
CELL_SIZE = 75.0
NODATA = -9999.0
WET_THRESHOLD_M = 0.05

GEOM = f"Geometry/2D Flow Areas/{AREA_NAME}"
BASE = "Results/Unsteady/Output/Output Blocks/Base Output"
CELL_XY = f"{GEOM}/Cells Center Coordinate"
CELL_Z = f"{GEOM}/Cells Minimum Elevation"
FACES_CELLS = f"{GEOM}/Faces Cell Indexes"
WSE = f"{BASE}/Unsteady Time Series/2D Flow Areas/{AREA_NAME}/Water Surface"
FACE_VEL = f"{BASE}/Unsteady Time Series/2D Flow Areas/{AREA_NAME}/Face Velocity"
TIME = f"{BASE}/Unsteady Time Series/Time"


def grid_layout(xy):
    valid = np.isfinite(xy).all(axis=1)
    x = xy[valid, 0]
    y = xy[valid, 1]
    left = float(x.min()) - CELL_SIZE / 2.0
    top = float(y.max()) + CELL_SIZE / 2.0
    width = int(math.ceil((float(x.max()) - float(x.min())) / CELL_SIZE)) + 1
    height = int(math.ceil((float(y.max()) - float(y.min())) / CELL_SIZE)) + 1
    transform = from_origin(left, top, CELL_SIZE, CELL_SIZE)
    cols = np.rint((xy[:, 0] - (left + CELL_SIZE / 2.0)) / CELL_SIZE).astype(np.int64)
    rows = np.rint(((top - CELL_SIZE / 2.0) - xy[:, 1]) / CELL_SIZE).astype(np.int64)
    ok = valid & (rows >= 0) & (rows < height) & (cols >= 0) & (cols < width)
    return rows, cols, ok, transform, width, height


def cell_to_grid(values, rows, cols, ok, height, width):
    out = np.full((height, width), NODATA, dtype=np.float32)
    good = ok & np.isfinite(values)
    if not np.any(good):
        return out
    sums = np.zeros((height, width), dtype=np.float64)
    counts = np.zeros((height, width), dtype=np.uint32)
    np.add.at(sums, (rows[good], cols[good]), values[good].astype(np.float32))
    np.add.at(counts, (rows[good], cols[good]), 1)
    m = counts > 0
    out[m] = (sums[m] / counts[m]).astype(np.float32)
    return out


def write_tif(path, arr, transform, crs=SOURCE_CRS):
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
                       dtype="float32", crs=crs, transform=transform, nodata=NODATA,
                       compress="deflate", predictor=2) as dst:
        dst.write(arr.astype(np.float32), 1)


def reproject_wgs84(src, dst):
    with rasterio.open(src) as s:
        transform, width, height = calculate_default_transform(s.crs, TARGET_CRS, s.width, s.height, *s.bounds)
        profile = s.profile.copy()
        profile.update(crs=TARGET_CRS, transform=transform, width=width, height=height,
                       dtype="float32", count=1, nodata=NODATA, compress="deflate", predictor=2)
        with rasterio.open(dst, "w", **profile) as d:
            reproject(rasterio.band(s, 1), rasterio.band(d, 1),
                      src_transform=s.transform, src_crs=s.crs,
                      dst_transform=transform, dst_crs=TARGET_CRS,
                      src_nodata=NODATA, dst_nodata=NODATA,
                      resampling=Resampling.nearest)


def main():
    if not HDF_PATH.exists():
        raise SystemExit(f"HEC-RAS HDF not found: {HDF_PATH}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    UTM_DIR.mkdir(parents=True, exist_ok=True)
    for p in OUT_DIR.glob("Depth_t*.tif"):
        p.unlink()
    for p in OUT_DIR.glob("Max_*.tif"):
        p.unlink()
    for p in OUT_DIR.glob("Arrival_Time_h.tif"):
        p.unlink()
    print("HEC-RAS -> JalDrishti export")
    print("HDF:", HDF_PATH)

    with h5py.File(HDF_PATH, "r") as f:
        xy = f[CELL_XY][:]
        z = f[CELL_Z][:]
        wse = f[WSE][:]
        face_vel = f[FACE_VEL][:]
        face_cells = f[FACES_CELLS][:]
        times_h = f[TIME][:].astype(np.float64) * 24.0

        if wse.ndim != 2 or wse.shape[1] != len(z):
            raise RuntimeError(f"Unexpected WSE shape {wse.shape}; terrain cells={len(z)}")
        if face_vel.ndim != 2 or face_vel.shape[1] != len(face_cells):
            raise RuntimeError(f"Unexpected face velocity shape {face_vel.shape}; face index rows={len(face_cells)}")

        rows, cols, ok, transform, width, height = grid_layout(xy)
        nframes, ncells = wse.shape
        print(f"cells={ncells}, frames={nframes}, raster={width}x{height}")
        print(f"hours={times_h[0]:.3f} -> {times_h[-1]:.3f}")

        depth_series = np.full((nframes, ncells), np.nan, dtype=np.float32)
        valid_z = np.isfinite(z)
        for i in range(nframes):
            valid = valid_z & np.isfinite(wse[i])
            depth_series[i, valid] = np.maximum(wse[i, valid] - z[valid], 0.0).astype(np.float32)

        with np.errstate(all="ignore"):
            max_depth = np.nanmax(depth_series, axis=0).astype(np.float32)
        max_depth[~np.isfinite(max_depth)] = NODATA

        arrival = np.full(ncells, np.nan, dtype=np.float32)
        for i in range(nframes):
            wet = np.isfinite(depth_series[i]) & (depth_series[i] > WET_THRESHOLD_M) & np.isnan(arrival)
            arrival[wet] = float(times_h[i])
        arrival[~np.isfinite(arrival)] = NODATA

        max_face = np.nanmax(np.abs(face_vel), axis=0).astype(np.float32)
        cell_max_vel = np.zeros(ncells, dtype=np.float32)
        for side in range(2):
            ids = face_cells[:, side].astype(np.int64, copy=False)
            valid_ids = (ids >= 0) & (ids < ncells) & np.isfinite(max_face)
            np.maximum.at(cell_max_vel, ids[valid_ids], max_face[valid_ids])

        frame_indices = list(range(nframes))
        # 2-hour playback checkpoints from the 10-minute output.
        unique_indices = list(range(0, nframes, 12))
        if unique_indices[-1] != nframes - 1:
            unique_indices.append(nframes - 1)

        for i in frame_indices:
            print(f"[{i+1:02d}/{nframes}] t={times_h[i]:.2f} h")
            grid = cell_to_grid(depth_series[i], rows, cols, ok, height, width)
            utm = UTM_DIR / f"Depth_t{i:02d}.tif"
            wgs = OUT_DIR / f"Depth_t{i:02d}.tif"
            write_tif(utm, grid, transform)
            reproject_wgs84(utm, wgs)

        max_grid = cell_to_grid(max_depth, rows, cols, ok, height, width)
        arr_grid = cell_to_grid(arrival, rows, cols, ok, height, width)
        vel_grid = cell_to_grid(cell_max_vel, rows, cols, ok, height, width)

        for name, grid in [("Max_Flood_Depth.tif", max_grid), ("Arrival_Time_h.tif", arr_grid), ("Max_Velocity.tif", vel_grid)]:
            utm = UTM_DIR / name
            wgs = OUT_DIR / name
            write_tif(utm, grid, transform)
            reproject_wgs84(utm, wgs)

        manifest = {
            "engine": "hec_ras",
            "model": "HEC-RAS 2D",
            "plan": "Breach2D",
            "area": AREA_NAME,
            "sourceHdf": "new_theri.p03.hdf",
            "sourceCrs": SOURCE_CRS,
            "outputCrs": TARGET_CRS,
            "cellCount": int(ncells),
            "meshResolutionM": CELL_SIZE,
            "frameCount": int(nframes),
            "outputIntervalMinutes": 10,
            "hours": [round(float(h), 6) for h in times_h],
            "files": [f"Depth_t{i:02d}.tif" for i in frame_indices],
            "uniqueIdx": unique_indices,
            "maxDepthFile": "Max_Flood_Depth.tif",
            "arrivalTimeFile": "Arrival_Time_h.tif",
            "velocityFile": "Max_Velocity.tif",
            "notes": [
                "Depth = HEC-RAS Water Surface minus HEC-RAS cell minimum elevation.",
                "Arrival = first exported frame with depth > 0.05 m.",
                "Velocity = maximum absolute face velocity propagated to adjacent cells.",
                "Output rasters are reprojected from UTM Zone 44N (EPSG:32644) to EPSG:4326.",
                "Legacy 1D baseline rasters are not overwritten.",
            ],
        }
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("MAX_DEPTH finite:", int(np.isfinite(max_depth[max_depth != NODATA]).sum()))
        print("WET CELLS:", int(np.sum(max_depth > WET_THRESHOLD_M)))
        print("MANIFEST:", MANIFEST_PATH)
        print("DONE")

if __name__ == "__main__":
    main()
