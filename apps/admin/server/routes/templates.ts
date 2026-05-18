import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  PARAMETRIC_TEMPLATES,
  getTemplate,
  defaultValues,
  validateParams,
  hashParams,
} from "@openpcb/core-import/templates";
import { buildFootprintRenderModel } from "@openpcb/core-import";
import { getIndex, rebuildIndex } from "../repo/index-cache";
import { FOOTPRINTS_DIR } from "../repo/paths";
import { writeJsonFile } from "../repo/write";
import { ajvFailReason, validateFootprint } from "../repo/validate";
import { ok, problem, type Handler } from "../http";

export const listTemplates: Handler = () => {
  return ok({
    items: PARAMETRIC_TEMPLATES.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      schema: t.schema,
      defaults: defaultValues(t.schema),
      generatorVersion: t.generatorVersion,
    })),
  });
};

interface MaterializeBody {
  values: Record<string, unknown>;
  category: string;
  license: string;
  slug?: string;
  attribution?: string[];
  conflictPolicy?: "refuse" | "overwrite";
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export const materializeTemplate: Handler = async (req, params) => {
  const id = params.id;
  if (!id) return problem(400, "no-id", "template id required");
  const tpl = getTemplate(id);
  if (!tpl) return problem(404, "no-template", `unknown template: ${id}`);

  let body: MaterializeBody;
  try {
    body = (await req.json()) as MaterializeBody;
  } catch {
    return problem(400, "invalid-body", "JSON body required");
  }
  if (!body.category) {
    return problem(400, "missing-category", "category required");
  }
  if (!body.license) {
    return problem(400, "missing-license", "license required");
  }

  const v = validateParams(tpl.schema, body.values ?? {});
  if (!v.ok) {
    return problem(
      422,
      "invalid-params",
      v.errors.map((e) => `${e.key}: ${e.message}`).join("; "),
    );
  }
  const result = tpl.generate(v.values);
  const preview = buildFootprintRenderModel(result.source);

  const category = slugify(body.category) || "generated";
  const slug = body.slug ? slugify(body.slug) : slugify(result.name);
  if (!slug) {
    return problem(400, "missing-slug", "could not derive slug");
  }
  const footprintId = `openpcb.core.${category}.footprint.${slug}`;

  const mountType: "smd" | "tht" = result.mountType === "smd" ? "smd" : "tht";

  const footprintFile = {
    id: footprintId,
    uuid: crypto.randomUUID(),
    version: "1.0.0",
    name: result.name,
    mountType,
    models3d: [],
    package: { code: result.packageCode, mountType, standard: "ipc-7351b" },
    provenance: {
      sourceKind: "generated",
      template: tpl.id,
      generatorVersion: tpl.generatorVersion,
      paramsHash: hashParams(v.values),
      generatedAt: new Date().toISOString(),
      license: body.license,
      ...(body.attribution && body.attribution.length > 0
        ? { attribution: body.attribution }
        : {}),
    },
    parser: { warnings: preview.warnings },
    normalized: { ...result, preview },
    raw: { values: v.values },
  };

  if (!validateFootprint(footprintFile)) {
    return problem(
      500,
      "schema-footprint",
      "generated footprint failed schema: " + ajvFailReason(validateFootprint),
    );
  }

  const idx = getIndex();
  if (idx.footprints.has(footprintId) && body.conflictPolicy !== "overwrite") {
    return problem(
      409,
      "conflict",
      `footprint ${footprintId} already exists. Pass conflictPolicy:"overwrite" or use a different slug.`,
    );
  }

  const dir = path.join(FOOTPRINTS_DIR, category);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `${slug}.fp.json`);
  writeJsonFile(abs, footprintFile);
  rebuildIndex();

  return ok({
    footprintId,
    path: path.relative(path.join(FOOTPRINTS_DIR, ".."), abs),
    tags: result.tags,
  });
};
