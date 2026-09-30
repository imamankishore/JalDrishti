import { Router } from "express";

import {
  getHecRasManifest,
  getHecRasStatus,
} from "../services/hecRasService.js";

const router = Router();

router.get("/tehri", async (req, res, next) => {
  try {
    const manifest = await getHecRasManifest();
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      source: "HEC-RAS 2D Breach2D",
      manifest,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/tehri/status", async (req, res, next) => {
  try {
    const status = await getHecRasStatus();
    return res.json({ success: true, status });
  } catch (error) {
    return next(error);
  }
});

export default router;
