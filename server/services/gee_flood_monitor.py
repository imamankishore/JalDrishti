"""
JalDrishti - Google Earth Engine Sentinel-1 flood monitor.

Uses the user's already working gcloud access token on every invocation,
so the Earth Engine CLI credential store is not required.

Output: one JSON object on stdout.
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import ee
from google.oauth2.credentials import Credentials

PROJECT_ID = os.environ.get("JALDRISHTI_GEE_PROJECT", "theri-dam")
GCLOUD = os.environ.get(
    "JALDRISHTI_GCLOUD",
    r"C:\Users\itsam\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
)

DAMS = {
    "tehri": {"lat": 30.378, "lon": 78.48, "radius_m": 18000, "name": "Tehri Dam"},
    "bhakra": {"lat": 31.416, "lon": 76.433, "radius_m": 18000, "name": "Bhakra Dam"},
    "hirakud": {"lat": 21.527, "lon": 83.872, "radius_m": 22000, "name": "Hirakud Dam"},
}


def fail(message: str, code: int = 1) -> None:
    print(json.dumps({"success": False, "error": message}))
    raise SystemExit(code)


def get_access_token() -> str:
    if not os.path.exists(GCLOUD):
        fail("gcloud.cmd was not found. Set JALDRISHTI_GCLOUD to the full path of gcloud.cmd.")
    try:
        token = subprocess.check_output(
            [GCLOUD, "auth", "print-access-token"],
            text=True,
            stderr=subprocess.STDOUT,
            timeout=30,
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail("Could not obtain a Google access token: " + exc.output.strip())
    except Exception as exc:
        fail("Could not obtain a Google access token: " + str(exc))
    if not token:
        fail("gcloud returned an empty access token.")
    return token


def initialize_earth_engine() -> None:
    token = get_access_token()
    creds = Credentials(
        token=token,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    try:
        ee.Initialize(credentials=creds, project=PROJECT_ID)
    except Exception as exc:
        fail("Earth Engine initialization failed: " + str(exc))


def edge_mask(image):
    edge = image.lt(-30.0)
    return image.updateMask(image.mask().And(edge.Not()))


def run(dam_key: str, lookback_days: int) -> dict:
    if dam_key not in DAMS:
        fail(f"Unsupported dam '{dam_key}'.")
    if lookback_days < 7 or lookback_days > 180:
        fail("lookback_days must be between 7 and 180.")

    initialize_earth_engine()

    dam = DAMS[dam_key]
    aoi = ee.Geometry.Point([dam["lon"], dam["lat"]]).buffer(dam["radius_m"])

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    end = (now + timedelta(days=1)).strftime("%Y-%m-%d")

    collection = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(aoi)
        .filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .select("VV")
        .map(edge_mask)
    )

    count = int(collection.size().getInfo())
    if count == 0:
        fail(f"No Sentinel-1 VV acquisitions found in the last {lookback_days} days.")

    ordered = collection.sort("system:time_start", False)
    latest = ee.Image(ordered.first())
    latest_time_ms = int(ee.Date(latest.get("system:time_start")).millis().getInfo())
    latest_dt = datetime.fromtimestamp(latest_time_ms / 1000, tz=timezone.utc)
    latest_date = latest_dt.strftime("%Y-%m-%d %H:%M UTC")

    orbit = latest.get("orbitProperties_pass").getInfo()
    relative_orbit = latest.get("relativeOrbitNumber_start").getInfo()

    baseline_start = (latest_dt - timedelta(days=120)).strftime("%Y-%m-%d")
    latest_day = latest_dt.strftime("%Y-%m-%d")
    baseline_col = (
        collection
        .filterDate(baseline_start, latest_day)
        .filter(ee.Filter.eq("orbitProperties_pass", orbit))
    )

    baseline_count = int(baseline_col.size().getInfo())

    if baseline_count > 0:
        baseline = baseline_col.median()
        latest_water = latest.lt(-15.0)
        baseline_non_water = baseline.gte(-15.0)
        new_water = latest_water.And(baseline_non_water)
    else:
        latest_water = latest.lt(-15.0)
        new_water = latest_water

    latest_water = latest_water.rename("water")
    new_water = new_water.rename("new_water")

    def area_km2(mask):
        result = (
            ee.Image.pixelArea()
            .rename("area")
            .updateMask(mask)
            .reduceRegion(
                reducer=ee.Reducer.sum(),
                geometry=aoi,
                scale=30,
                maxPixels=1_000_000_000,
                bestEffort=True,
            )
            .get("area")
        )
        value = result.getInfo() if result else 0
        return round(float(value or 0) / 1e6, 3)

    water_area_km2 = area_km2(latest_water)
    new_water_area_km2 = area_km2(new_water)

    flood_vis = new_water.selfMask().visualize(
        min=0,
        max=1,
        palette=["00BFFF"],
    )
    radar_vis = latest.visualize(
        min=-25,
        max=0,
        palette=["111827", "475569", "cbd5e1", "ffffff"],
    )

    try:
        tile_url = ee.Image(flood_vis).getMapId({})["tile_fetcher"].url_format
        radar_tile_url = ee.Image(radar_vis).getMapId({})["tile_fetcher"].url_format
    except Exception as exc:
        fail("Could not create Earth Engine map tiles: " + str(exc))

    return {
        "success": True,
        "dam": dam_key,
        "damName": dam["name"],
        "source": "Copernicus Sentinel-1 GRD via Google Earth Engine",
        "collection": "COPERNICUS/S1_GRD",
        "latestObservationUtc": latest_date,
        "imageCount": count,
        "baselineImageCount": baseline_count,
        "orbit": orbit,
        "relativeOrbit": relative_orbit,
        "waterAreaKm2": water_area_km2,
        "newWaterAreaKm2": new_water_area_km2,
        "tileUrl": tile_url,
        "radarTileUrl": radar_tile_url,
        "center": [dam["lat"], dam["lon"]],
        "processing": {
            "waterRule": "Indicative VV < -15 dB",
            "changeRule": "Latest water pixels that were >= -15 dB in same-orbit historical baseline",
            "aoiRadiusKm": round(dam["radius_m"] / 1000, 1),
            "isForecast": False,
        },
        "note": (
            "Satellite-derived observation, not a forecast. "
            "Water-change detection is indicative and should be calibrated before operational use."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dam", default="tehri", choices=sorted(DAMS))
    parser.add_argument("--lookback-days", type=int, default=60)
    args = parser.parse_args()

    try:
        print(json.dumps(run(args.dam, args.lookback_days), separators=(",", ":")))
    except SystemExit:
        raise
    except Exception as exc:
        fail("Unexpected Earth Engine error: " + str(exc))


if __name__ == "__main__":
    main()
