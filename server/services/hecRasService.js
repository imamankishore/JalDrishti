import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANIFEST_PATH = path.join(
  __dirname,
  "..",
  "data",
  "rasters",
  "tehri_2d",
  "manifest.json"
);

const HDF_PATH =
  process.env.HECRAS_HDF_PATH ||
  "C:\\Users\\itsam\\new_dam_project\\new_theri.p03.hdf";

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getHecRasManifest() {
  if (!(await exists(MANIFEST_PATH))) {
    throw Object.assign(
      new Error(
        "HEC-RAS Breach2D rasters are not exported yet. Run: python tools\\export_hecras_backend.py"
      ),
      { status: 503 }
    );
  }

  const raw = await fs.readFile(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(raw);

  return {
    ...manifest,
    hdfPath: HDF_PATH,
  };
}

export async function getHecRasStatus() {
  const manifestExists = await exists(MANIFEST_PATH);
  const hdfExists = await exists(HDF_PATH);

  return {
    configured: true,
    hdfPath: HDF_PATH,
    hdfExists,
    manifestExists,
  };
}
