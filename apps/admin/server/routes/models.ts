import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MODELS_DIR, STEP_CACHE_DIR } from "../repo/paths";
import { getIndex, rebuildIndex } from "../repo/index-cache";
import { findFootprintsReferencingModel } from "../repo/safety";
import { ok, problem, type Handler } from "../http";

export const listModels: Handler = () => {
  const idx = getIndex();
  return ok({
    items: [...idx.models.values()].map((m) => ({
      slug: m.slug,
      category: m.category,
      relPath: m.glbRelPath,
      referencedBy: m.referencedBy,
    })),
  });
};

export const getModelGlb: Handler = (_req, params) => {
  const idx = getIndex();
  const key = `${params.category}/${params.slug}`;
  const m = idx.models.get(key);
  if (!m) return problem(404, "not-found", `model ${key}`);
  const file = Bun.file(m.glbAbsPath);
  return new Response(file, {
    headers: {
      "content-type": "model/gltf-binary",
      "cache-control": "public, max-age=300",
    },
  });
};

export const uploadModel: Handler = async (req, params) => {
  const category = (params.category ?? "").trim();
  const slug = (params.slug ?? "").trim();
  if (!category || !slug) {
    return problem(400, "invalid-path", "category and slug required");
  }
  const form = await req.formData().catch(() => null);
  if (!form)
    return problem(400, "invalid-body", "multipart/form-data required");
  const glb = form.get("glb");
  if (!(glb instanceof Blob))
    return problem(400, "missing-glb", "glb field required");
  const bytes = new Uint8Array(await glb.arrayBuffer());
  // Validate magic: "glTF" little-endian = 0x46546C67
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x67 ||
    bytes[1] !== 0x6c ||
    bytes[2] !== 0x54 ||
    bytes[3] !== 0x46
  ) {
    return problem(400, "invalid-glb", "missing glTF magic bytes");
  }

  const targetDir = path.join(MODELS_DIR, category);
  mkdirSync(targetDir, { recursive: true });
  const targetGlb = path.join(targetDir, `${slug}.glb`);
  writeFileSync(targetGlb, bytes);

  const step = form.get("step");
  let stepStored: string | null = null;
  if (step instanceof Blob && step.size > 0) {
    mkdirSync(STEP_CACHE_DIR, { recursive: true });
    const stepCat = path.join(STEP_CACHE_DIR, category);
    mkdirSync(stepCat, { recursive: true });
    const stepPath = path.join(stepCat, `${slug}.step`);
    writeFileSync(stepPath, new Uint8Array(await step.arrayBuffer()));
    stepStored = path.relative(STEP_CACHE_DIR, stepPath);
  }

  rebuildIndex();
  return ok(
    { slug, category, byteSize: bytes.length, stepStored },
    { status: 201 },
  );
};

export const deleteModel: Handler = (_req, params) => {
  const idx = getIndex();
  const key = `${params.category}/${params.slug}`;
  const m = idx.models.get(key);
  if (!m) return problem(404, "not-found", `model ${key}`);
  const refs = findFootprintsReferencingModel(m.slug);
  if (refs.length > 0) {
    return problem(
      409,
      "model-referenced",
      `footprints reference this model: ${refs.join(", ")}`,
    );
  }
  if (existsSync(m.glbAbsPath)) unlinkSync(m.glbAbsPath);
  rebuildIndex();
  return ok({ removed: m.slug });
};
