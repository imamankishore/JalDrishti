import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// --------------------------------------------------
// Paths
// --------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMPACT_FILE = path.join(
  __dirname,
  "..",
  "data",
  "impact.json"
);

// --------------------------------------------------
// Helpers
// --------------------------------------------------

const isObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value);

const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const cleanString = (value, fallback = "") => {
  if (value === null || value === undefined) {
    return fallback;
  }

  const text = String(value).trim();

  return text || fallback;
};

// --------------------------------------------------
// Load impact rows
// --------------------------------------------------

export function loadImpactRows() {
  try {
    if (!fs.existsSync(IMPACT_FILE)) {
      console.warn(
        "Impact data file not found:",
        IMPACT_FILE
      );

      return [];
    }

    const raw = fs.readFileSync(
      IMPACT_FILE,
      "utf-8"
    );

    if (!raw.trim()) {
      console.warn(
        "Impact data file is empty:",
        IMPACT_FILE
      );

      return [];
    }

    const parsed = JSON.parse(raw);

    // Support a few possible existing JSON structures.
    let rows = [];

    if (Array.isArray(parsed)) {
      rows = parsed;
    } else if (isObject(parsed)) {
      if (Array.isArray(parsed.settlements)) {
        rows = parsed.settlements;
      } else if (Array.isArray(parsed.rows)) {
        rows = parsed.rows;
      } else if (Array.isArray(parsed.features)) {
        rows = parsed.features;
      } else if (Array.isArray(parsed.data)) {
        rows = parsed.data;
      }
    }

    if (!Array.isArray(rows)) {
      console.warn(
        "Unsupported impact.json structure."
      );

      return [];
    }

    return rows
      .filter((row) => isObject(row))
      .map((row) => {
        const depth =
          toFiniteNumber(
            row.maxDepthM ??
              row.max_depth_m ??
              row.depthM ??
              row.depth
          );

        const arrival =
          toFiniteNumber(
            row.arrivalTimeH ??
              row.arrival_time_h ??
              row.arrivalH ??
              row.arrival
          );

        const lat =
          toFiniteNumber(
            row.lat ??
              row.latitude ??
              row.Latitude
          );

        const lon =
          toFiniteNumber(
            row.lon ??
              row.lng ??
              row.longitude ??
              row.Longitude
          );

        const wetPixels =
          toFiniteNumber(
            row.wetPixels ??
              row.wet_pixels
          );

        const normalized = {
          ...row,

          name: cleanString(
            row.name ??
              row.Name ??
              row.settlement ??
              row.village,
            "Unnamed"
          ),

          lat,
          lon,

          maxDepthM: depth,

          arrivalTimeH: arrival,

          arrivalMethod:
            row.arrivalMethod ??
            row.arrival_method ??
            null,

          arrivalConfidence:
            row.arrivalConfidence ??
            row.arrival_confidence ??
            null,

          nearPool:
            typeof row.nearPool === "boolean"
              ? row.nearPool
              : typeof row.near_pool === "boolean"
                ? row.near_pool
                : null,

          wetPixels,

          alert:
            cleanString(
              row.alert,
              depth !== null && depth >= 2
                ? "SEVERE"
                : depth !== null && depth >= 1
                  ? "HIGH"
                  : depth !== null && depth >= 0.3
                    ? "MODERATE"
                    : "LOW"
            ).toUpperCase(),
        };

        return normalized;
      });
  } catch (error) {
    console.error(
      "Could not load impact data:",
      error.message
    );

    return [];
  }
}

// --------------------------------------------------
// Existing precomputed impact response
// --------------------------------------------------

export function loadPrecomputedImpact() {
  const rows = loadImpactRows();

  if (!rows.length) {
    return null;
  }

  const hit = rows
    .filter(
      (row) =>
        String(row.alert || "").toUpperCase() !== "LOW"
    )
    .sort(
      (a, b) =>
        (b.maxDepthM ?? 0) -
        (a.maxDepthM ?? 0)
    );

  const nearPoolCount = hit.filter(
    (row) => row.nearPool === true
  ).length;

  const outsidePoolCount = hit.filter(
    (row) => row.nearPool === false
  ).length;

  const na =
    "not computed (settlements only)";

  return {
    status: "completed",

    // IMPORTANT:
    // This is the currently stored settlement-impact
    // dataset, not the newly generated HEC-RAS 2D raster.
    source:
      "HEC-RAS settlement impact dataset + OpenStreetMap settlements",

    sourceType: "precomputed",

    affectedAssets: [
      {
        type: "Villages",
        affected: hit.length,
        unit:
          "settlements (flood depth >= 0.3 m)",
      },
      {
        type: "Buildings",
        affected: "N/A",
        unit: na,
      },
      {
        type: "Roads",
        affected: "N/A",
        unit: na,
      },
      {
        type: "Bridges",
        affected: "N/A",
        unit: na,
      },
      {
        type: "Critical Infrastructure",
        affected: "N/A",
        unit: na,
      },
    ],

    meta: {
      impactedFeatures: hit.length,

      nearPoolCount,

      outsidePoolCount,

      totalSettlements: rows.length,

      thresholdM: 0.3,

      examples: hit
        .slice(0, 60)
        .map((row) => ({
          type: "settlements",

          name:
            row.name ||
            "Unnamed",

          depthM:
            row.maxDepthM,

          arrivalTimeH:
            row.arrivalTimeH ?? null,

          arrivalMethod:
            row.arrivalMethod ?? null,

          arrivalConfidence:
            row.arrivalConfidence ?? null,

          nearPool:
            row.nearPool ?? null,

          wetPixels:
            row.wetPixels ?? null,

          alert:
            row.alert,

          lat:
            row.lat,

          lon:
            row.lon,
        })),

      note:
        "Settlement impact is based on the existing precomputed HEC-RAS settlement dataset. It is a fixed baseline dataset and should not be interpreted as dynamically recomputed from arbitrary UI scenario parameters.",

      generatedAt:
        new Date().toISOString(),
    },
  };
}

// --------------------------------------------------
// Realtime alerts endpoint compatibility
// --------------------------------------------------

export async function getRealtimeAlerts({
  dam = "tehri",
} = {}) {
  if (dam !== "tehri") {
    return {
      status: "completed",

      dam,

      sourceType: "unavailable",

      alerts: [],

      count: 0,

      message:
        "Realtime impact alerts are currently available for Tehri only.",
    };
  }

  const impact =
    loadPrecomputedImpact();

  if (!impact) {
    return {
      status: "completed",

      dam: "tehri",

      sourceType: "precomputed",

      alerts: [],

      count: 0,
    };
  }

  return {
    status:
      impact.status ||
      "completed",

    dam: "tehri",

    source:
      impact.source,

    sourceType:
      impact.sourceType ||
      "precomputed",

    alerts:
      impact.meta?.examples ||
      [],

    count:
      impact.meta?.impactedFeatures ||
      0,

    meta:
      impact.meta ||
      {},
  };
}