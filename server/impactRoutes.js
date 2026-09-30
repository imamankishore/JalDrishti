import express from "express";

import {
  loadImpactRows,
  loadPrecomputedImpact,
} from "./services/impactAlertService.js";

const router = express.Router();

// --------------------------------------------------
// GET /api/impact
// --------------------------------------------------
// Existing frontend expects:
// {
//   settlements: [...]
// }

router.get("/api/impact", (req, res, next) => {
  try {
    const dam = String(
      req.query.dam || "tehri"
    ).toLowerCase();

    if (dam !== "tehri") {
      return res.json({
        success: true,

        dam,

        sourceType: "unavailable",

        settlements: [],

        count: 0,

        message:
          "Settlement impact data is currently available for Tehri only.",
      });
    }

    const rows =
      loadImpactRows();

    const settlements = rows.map(
      (row) => ({
        name:
          row.name ||
          "Unnamed settlement",

        lat:
          row.lat,

        lon:
          row.lon,

        alert:
          row.alert ||
          "LOW",

        maxDepthM:
          row.maxDepthM ??
          null,

        arrivalTimeH:
          row.arrivalTimeH ??
          null,

        arrivalMethod:
          row.arrivalMethod ??
          null,

        arrivalConfidence:
          row.arrivalConfidence ??
          null,

        nearPool:
          row.nearPool ??
          null,

        wetPixels:
          row.wetPixels ??
          null,
      })
    );

    return res.json({
      success: true,

      dam: "tehri",

      source:
        "Existing precomputed settlement impact dataset",

      sourceType:
        "precomputed",

      settlements,

      count:
        settlements.length,
    });
  } catch (error) {
    return next(error);
  }
});

// --------------------------------------------------
// GET /api/impact/summary
// --------------------------------------------------

router.get(
  "/api/impact/summary",
  (req, res, next) => {
    try {
      const impact =
        loadPrecomputedImpact();

      if (!impact) {
        return res.json({
          success: true,

          status: "completed",

          sourceType: "precomputed",

          affectedAssets: [],

          meta: {
            impactedFeatures: 0,
            totalSettlements: 0,
          },
        });
      }

      return res.json({
        success: true,

        ...impact,
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;