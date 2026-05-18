import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildInspectResponse,
  commitKicadImport,
  ImportValidationError,
  extractZipEntries,
  type InspectKicadRequest,
  type CommitInput,
} from "@openpcb/core-import";
import { getIndex, rebuildIndex } from "../repo/index-cache";
import { COMPONENTS_DIR, FOOTPRINTS_DIR, SYMBOLS_DIR } from "../repo/paths";
import { writeJsonFile } from "../repo/write";
import {
  ajvFailReason,
  validateComponent,
  validateFootprint,
  validateSymbol,
} from "../repo/validate";
import { ok, problem, type Handler } from "../http";

interface MultipartFile {
  fileName: string;
  bytes: Uint8Array;
}

async function readMultipart(req: Request): Promise<MultipartFile[]> {
  const form = await req.formData();
  const files: MultipartFile[] = [];
  for (const [, value] of form.entries()) {
    if (typeof value === "string") continue;
    const blob = value as Blob & { name?: string };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    files.push({ fileName: blob.name ?? "unnamed", bytes });
  }
  return files;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function isKicadSym(name: string): boolean {
  return name.toLowerCase().endsWith(".kicad_sym");
}

function isKicadMod(name: string): boolean {
  return name.toLowerCase().endsWith(".kicad_mod");
}

function isZip(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

interface ExpandedInputs {
  symbolLibrary: { fileName: string; content: string } | null;
  footprints: Array<{ fileName: string; content: string }>;
  model3dFiles: Array<{ fileName: string }>;
}

function expandFiles(files: MultipartFile[]): ExpandedInputs {
  const out: ExpandedInputs = {
    symbolLibrary: null,
    footprints: [],
    model3dFiles: [],
  };
  for (const f of files) {
    if (isKicadSym(f.fileName)) {
      // If multiple .kicad_sym, last wins (mirrors desktop)
      out.symbolLibrary = {
        fileName: f.fileName,
        content: decodeText(f.bytes),
      };
    } else if (isKicadMod(f.fileName)) {
      out.footprints.push({
        fileName: f.fileName,
        content: decodeText(f.bytes),
      });
    } else if (isZip(f.fileName)) {
      const entries = extractZipEntries(f.bytes);
      for (const e of entries) {
        if (isKicadSym(e.baseName)) {
          out.symbolLibrary = {
            fileName: e.baseName,
            content: decodeText(e.bytes),
          };
        } else if (isKicadMod(e.baseName)) {
          out.footprints.push({
            fileName: e.baseName,
            content: decodeText(e.bytes),
          });
        } else if (/\.(step|stp|glb|wrl)$/i.test(e.baseName)) {
          out.model3dFiles.push({ fileName: e.baseName });
        }
      }
    } else if (/\.(step|stp|glb|wrl)$/i.test(f.fileName)) {
      out.model3dFiles.push({ fileName: f.fileName });
    }
  }
  return out;
}

export const inspectKicad: Handler = async (req) => {
  let files: MultipartFile[];
  try {
    files = await readMultipart(req);
  } catch (err) {
    return problem(400, "invalid-multipart", (err as Error).message);
  }
  if (files.length === 0) {
    return problem(400, "no-files", "Provide at least one KiCad file or .zip");
  }
  const inputs = expandFiles(files);
  if (!inputs.symbolLibrary) {
    return problem(
      400,
      "no-symbol-library",
      "A .kicad_sym file is required (none found in upload or zip)",
    );
  }
  if (inputs.footprints.length === 0) {
    return problem(400, "no-footprint", "At least one .kicad_mod is required");
  }
  try {
    const inspectReq: InspectKicadRequest = {
      symbolLibrary: inputs.symbolLibrary,
      footprints: inputs.footprints,
      model3dFiles: inputs.model3dFiles,
    };
    const resp = buildInspectResponse(inspectReq);
    // Echo back so commit can replay without re-uploading
    return ok({ ...resp, _inputs: inputs });
  } catch (err) {
    if (err instanceof ImportValidationError) {
      return problem(422, "inspect-failed", err.message);
    }
    return problem(500, "inspect-error", (err as Error).message);
  }
};

interface CommitBody {
  inputs: ExpandedInputs;
  selection: { symbolId: string; footprintId: string };
  component: {
    name: string;
    description?: string;
    category: string;
    license: string;
    tags?: string[];
    attribution?: string[];
    slug?: string;
  };
  conflictPolicy?: "refuse" | "overwrite";
}

export const commitKicad: Handler = async (req) => {
  let body: CommitBody;
  try {
    body = (await req.json()) as CommitBody;
  } catch {
    return problem(400, "invalid-body", "JSON body required");
  }
  if (!body?.inputs?.symbolLibrary || !body?.inputs?.footprints?.length) {
    return problem(
      400,
      "invalid-body",
      "inputs.symbolLibrary + footprints required",
    );
  }
  if (!body.selection?.symbolId || !body.selection?.footprintId) {
    return problem(
      400,
      "invalid-body",
      "selection.symbolId/footprintId required",
    );
  }
  if (
    !body.component?.name ||
    !body.component?.category ||
    !body.component?.license
  ) {
    return problem(
      400,
      "invalid-body",
      "component.name/category/license required",
    );
  }

  let result: ReturnType<typeof commitKicadImport>;
  try {
    const input: CommitInput = {
      symbolLibrary: body.inputs.symbolLibrary,
      footprints: body.inputs.footprints,
      selection: body.selection,
      component: {
        name: body.component.name,
        description: body.component.description ?? "",
        category: body.component.category,
        license: body.component.license,
        ...(body.component.tags ? { tags: body.component.tags } : {}),
        ...(body.component.attribution
          ? { attribution: body.component.attribution }
          : {}),
        ...(body.component.slug ? { slug: body.component.slug } : {}),
      },
    };
    result = commitKicadImport(input);
  } catch (err) {
    if (err instanceof ImportValidationError) {
      return problem(422, "commit-validation", err.message);
    }
    return problem(500, "commit-error", (err as Error).message);
  }

  // Ajv-validate against on-disk schemas before persisting
  if (!validateSymbol(result.symbol)) {
    return problem(
      500,
      "schema-symbol",
      "symbol: " + ajvFailReason(validateSymbol),
    );
  }
  if (result.footprint && !validateFootprint(result.footprint)) {
    return problem(
      500,
      "schema-footprint",
      "footprint: " + ajvFailReason(validateFootprint),
    );
  }
  if (!validateComponent(result.component)) {
    return problem(
      500,
      "schema-component",
      "component: " + ajvFailReason(validateComponent),
    );
  }

  // Conflict detection against current index
  const idx = getIndex();
  const conflicts: Array<{ kind: string; id: string }> = [];
  if (idx.symbols.has(result.symbol.id)) {
    conflicts.push({ kind: "symbol", id: result.symbol.id });
  }
  if (result.footprint && idx.footprints.has(result.footprint.id)) {
    conflicts.push({ kind: "footprint", id: result.footprint.id });
  }
  if (idx.components.has(result.component.id)) {
    conflicts.push({ kind: "component", id: result.component.id });
  }
  if (conflicts.length > 0 && body.conflictPolicy !== "overwrite") {
    return problem(
      409,
      "conflict",
      `Existing entries: ${conflicts
        .map((c) => `${c.kind}:${c.id}`)
        .join(", ")}. Pass conflictPolicy:"overwrite" or change slug.`,
    );
  }

  // Persist
  const category = body.component.category;
  const slug = body.component.slug ?? slugFromId(result.component.id);
  const symbolDir = path.join(SYMBOLS_DIR, category);
  const footprintDir = path.join(FOOTPRINTS_DIR, category);
  const componentDir = path.join(COMPONENTS_DIR, category);
  for (const d of [symbolDir, footprintDir, componentDir]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  const symbolPath = path.join(symbolDir, `${slug}.symbol.json`);
  const componentPath = path.join(componentDir, `${slug}.component.json`);

  writeJsonFile(symbolPath, result.symbol);
  let footprintPath: string | null = null;
  if (result.footprint) {
    footprintPath = path.join(footprintDir, `${slug}.fp.json`);
    writeJsonFile(footprintPath, result.footprint);
  }
  writeJsonFile(componentPath, result.component);
  rebuildIndex();

  return ok({
    componentId: result.component.id,
    symbolId: result.symbol.id,
    footprintId: result.footprint?.id ?? null,
    paths: {
      symbol: path.relative(path.join(SYMBOLS_DIR, ".."), symbolPath),
      footprint: footprintPath
        ? path.relative(path.join(FOOTPRINTS_DIR, ".."), footprintPath)
        : null,
      component: path.relative(path.join(COMPONENTS_DIR, ".."), componentPath),
    },
  });
};

function slugFromId(componentId: string): string {
  // openpcb.core.<cat>.<slug>
  const parts = componentId.split(".");
  return parts[parts.length - 1] ?? "untitled";
}
