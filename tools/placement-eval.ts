/**
 * Single source of truth for "convert a model sidecar to a baked GLB, measure
 * its bounds, and run the orientation gate against its footprint". Shared by
 * `audit-3d-placement.ts`, `render-3d-contact-sheet.ts`, the pack bounds step
 * and the test suite so they can never drift apart.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { convertStepToGlbNode } from "@openpcb/step-to-glb/node";
import type { Model3DRef } from "@openpcb/step-to-glb";
import { REPO_ROOT } from "./lib";
import { computeGlbBounds, type ModelBounds } from "./glb-bounds";
import {
  evaluateOrientation,
  normalizeMountType,
  orientationHintFromName,
  referenceBounds,
  worstSeverity,
  type Finding,
  type Severity,
} from "./orientation-gate";

export const STEP_TO_GLB_PARAMS = {
  linearUnit: "millimeter" as const,
  linearDeflectionType: "absolute_value" as const,
  linearDeflection: 0.05,
  angularDeflection: 0.5,
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ModelSidecar {
  id: string;
  name?: string;
  formats: { step?: { path: string }; glb?: { path: string } };
  offsetMm?: Vec3;
  rotationDeg?: Vec3;
  scaleMm?: Vec3;
}

export interface FootprintSidecar {
  id: string;
  name?: string;
  mountType?: string;
  models3d?: string[];
  normalized?: {
    preview?: {
      pads?: Array<{
        number?: string;
        centerMm?: { x: number; y: number };
        widthMm?: number;
        heightMm?: number;
      }>;
      graphics?: Array<{
        a?: { x: number; y: number };
        b?: { x: number; y: number };
        center?: { x: number; y: number };
        radiusMm?: number;
      }>;
    };
  };
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const IDENTITY: Vec3 = { x: 1, y: 1, z: 1 };

export function modelRefFromSidecar(model: ModelSidecar): Model3DRef {
  const stepPath = model.formats.step?.path ?? "";
  return {
    path: stepPath,
    resolvedFileName: path.basename(stepPath),
    offset: model.offsetMm ?? ZERO,
    rotation: model.rotationDeg ?? ZERO,
    scale: model.scaleMm ?? IDENTITY,
  };
}

export interface ConvertedModel {
  glbBytes: Uint8Array;
  bounds: ModelBounds;
}

/**
 * Convert a model's STEP to a baked GLB (same transform/axis policy as pack)
 * and measure the result. Throws on conversion failure or missing STEP.
 */
export async function convertModel(
  model: ModelSidecar,
): Promise<ConvertedModel> {
  const stepPath = model.formats.step?.path;
  if (!stepPath) throw new Error(`model ${model.id} has no STEP format`);
  const abs = path.join(REPO_ROOT, stepPath);
  const bytes = readFileSync(abs);
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const result = await convertStepToGlbNode(
    ab,
    STEP_TO_GLB_PARAMS,
    modelRefFromSidecar(model),
    { axisCorrection: "none" },
  );
  if (result.status !== "ok") {
    throw new Error(`STEP→GLB failed for ${model.id}: ${result.message}`);
  }
  const glbBytes = new Uint8Array(result.glbBytes);
  const bounds = await computeGlbBounds(glbBytes);
  return { glbBytes, bounds };
}

export interface PlacementResult {
  findings: Finding[];
  verdict: Severity | "ok";
}

/** Run the orientation gate for a footprint + its (already measured) model. */
export function evaluatePlacement(
  footprint: FootprintSidecar,
  bounds: ModelBounds,
): PlacementResult {
  const findings = evaluateOrientation({
    mountType: normalizeMountType(footprint.mountType),
    bounds,
    reference: referenceBounds(footprint.normalized?.preview),
    orientationHint: orientationHintFromName(footprint.name),
  });
  return { findings, verdict: worstSeverity(findings) ?? "ok" };
}
