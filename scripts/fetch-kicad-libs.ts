#!/usr/bin/env bun
/**
 * fetch-kicad-libs — verify (not clone) the vendored KiCad official-libraries checkout.
 *
 * The KiCad symbol/footprint/3D libraries are vendored at ../references/kicad-libs
 * (relative to the CoreLibrary repo root), pinned to the commit below. Import manifests
 * resolve their source paths against this tree via `--kicad-root` (default the same path).
 * This script asserts the expected layout exists and prints the pin so provenance
 * (`upstreamCommit`) stays reproducible. It deliberately does not network-clone — the
 * checkout is part of the workspace.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const KICAD_UPSTREAM_URL = "https://gitlab.com/kicad/libraries";
const KICAD_UPSTREAM_COMMIT = "c7e226a49"; // KiCad 10.0.4
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const KICAD_ROOT = path.resolve(REPO_ROOT, "..", "references", "kicad-libs");
const REQUIRED_DIRS = ["kicad-symbols", "kicad-footprints", "kicad-packages3D"];

const missing = REQUIRED_DIRS.filter(
  (dir) => !existsSync(path.join(KICAD_ROOT, dir)),
);
if (missing.length > 0) {
  console.error(
    `[fetch-kicad-libs] missing under ${KICAD_ROOT}: ${missing.join(", ")}`,
  );
  console.error(
    `[fetch-kicad-libs] expected the vendored KiCad libraries (${KICAD_UPSTREAM_URL} @ ${KICAD_UPSTREAM_COMMIT}).`,
  );
  process.exit(1);
}

console.log(`[fetch-kicad-libs] OK — KiCad libraries present at ${KICAD_ROOT}`);
console.log(
  `[fetch-kicad-libs] pinned: ${KICAD_UPSTREAM_URL} @ ${KICAD_UPSTREAM_COMMIT} (KiCad 10.0.4)`,
);
console.log(
  "[fetch-kicad-libs] symbols are unpacked per-symbol files: <Lib>.kicad_symdir/<Name>.kicad_sym",
);
