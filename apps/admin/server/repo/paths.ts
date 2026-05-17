import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");
export const SYMBOLS_DIR = path.join(REPO_ROOT, "symbols");
export const FOOTPRINTS_DIR = path.join(REPO_ROOT, "footprints");
export const COMPONENTS_DIR = path.join(REPO_ROOT, "components");
export const MODELS_DIR = path.join(REPO_ROOT, "3d");
export const SCHEMAS_DIR = path.join(REPO_ROOT, "schemas");
export const STEP_CACHE_DIR = path.join(REPO_ROOT, ".step-cache");
