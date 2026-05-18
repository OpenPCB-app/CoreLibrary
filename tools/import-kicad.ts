#!/usr/bin/env bun
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./lib";
import {
  parseKicadFootprint,
  parseKicadSymbolLib,
} from "@openpcb/kicad-parsers";
import {
  buildInspectResponse,
  parseImportBundle,
  validateFootprintPads,
  validateSymbolPinsCoverFootprintPads,
} from "@openpcb/kicad-import";

const COMPONENTS = {
  resistor: { category: "passive", name: "Resistor", ref: "R" },
  capacitor: { category: "passive", name: "Capacitor", ref: "C" },
} as const;
const LICENSE = "CC-BY-SA-4.0+KiCad-Libraries-Exception";
const TOOL = "CoreLibrary tools/import-kicad.ts";

type ComponentKind = keyof typeof COMPONENTS;
type Args = {
  component: ComponentKind;
  symbol: string;
  footprint: string;
  step: string;
  out: string;
};

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--") || !arg.includes("="))
      throw new Error(`Invalid argument: ${arg}`);
    const [key, ...rest] = arg.slice(2).split("=");
    if (!key) throw new Error(`Invalid argument: ${arg}`);
    values.set(key, rest.join("="));
  }
  const component = values.get("component");
  if (component !== "resistor" && component !== "capacitor") {
    throw new Error("--component must be resistor or capacitor");
  }
  const required = ["symbol", "footprint", "step"] as const;
  for (const key of required) {
    const value = values.get(key);
    if (!value || !path.isAbsolute(value))
      throw new Error(`--${key} must be an absolute path`);
  }
  const out = values.get("out") ?? ".";
  if (!path.isAbsolute(out)) throw new Error("--out must be an absolute path");
  return {
    component,
    symbol: values.get("symbol")!,
    footprint: values.get("footprint")!,
    step: values.get("step")!,
    out,
  };
}

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

function generateUuid(): string {
  return randomUUID();
}

function provenance(
  format: string,
  fileName: string,
  library: string,
  item: string,
  hash: string,
  convertedAt: string,
) {
  return {
    source: "kicad-derived",
    license: LICENSE,
    attribution: ["Derived from KiCad official libraries."],
    sourceFormat: format,
    sourceFileName: fileName,
    sourceLibrary: library,
    sourceItemName: item,
    sourceHash: hash,
    upstreamUrl: "https://gitlab.com/kicad/libraries",
    convertedAt,
    conversionTool: TOOL,
  };
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const [symbolContent, footprintContent] = await Promise.all([
    readFile(args.symbol, "utf8"),
    readFile(args.footprint, "utf8"),
  ]);
  const parsedSymbols = parseKicadSymbolLib(symbolContent);
  const parsedFootprint = parseKicadFootprint(footprintContent);
  const request = {
    symbolLibrary: {
      fileName: path.basename(args.symbol),
      content: symbolContent,
    },
    footprints: [
      { fileName: path.basename(args.footprint), content: footprintContent },
    ],
    model3dFiles: [{ fileName: path.basename(args.step) }],
  };
  buildInspectResponse(request);
  const bundle = parseImportBundle(request);
  const symbol = bundle.normalizedSymbols[0];
  const footprint = bundle.normalizedFootprints[0];
  if (!symbol || !footprint || !parsedSymbols.symbols[0])
    throw new Error("Import produced no symbol or footprint");
  validateFootprintPads(footprint.preview);
  validateSymbolPinsCoverFootprintPads(symbol, footprint.preview);

  const config = COMPONENTS[args.component];
  const category = config.category;
  const componentSlug = args.component;
  const footprintSlug = slugify(parsedFootprint.name);
  const convertedAt = new Date().toISOString();
  const symbolHash = sha256(symbolContent);
  const footprintHash = sha256(footprintContent);
  const stepHash = sha256File(args.step);
  const symbolId = `openpcb.core.symbol.${category}.${componentSlug}`;
  const footprintId = `openpcb.core.footprint.${category}.${footprintSlug}`;
  const componentId = `openpcb.core.${category}.${componentSlug}`;
  const modelId = `openpcb.core.3d.${category}.${footprintSlug}`;
  const modelRel = `3d/${category}/${footprintSlug}.step`;

  const pinMap = symbol.pins.map((pin) => ({
    pinNumber: pin.number ?? "",
    padNumber: pin.number ?? "",
    pinName: pin.name,
  }));
  const modelRef = parsedFootprint.model3dRefs[0];
  const symbolPath = path.join(
    args.out,
    "symbols",
    category,
    `${componentSlug}.symbol.json`,
  );
  const footprintPath = path.join(
    args.out,
    "footprints",
    category,
    `${footprintSlug}.fp.json`,
  );
  const componentPath = path.join(
    args.out,
    "components",
    category,
    `${componentSlug}.component.json`,
  );
  const stepPath = path.join(args.out, modelRel);
  const modelPath = path.join(
    args.out,
    "3d",
    category,
    `${footprintSlug}.model.json`,
  );

  await Promise.all([
    writeJson(symbolPath, {
      id: symbolId,
      uuid: generateUuid(),
      version: "1.0.0",
      name: config.name,
      referencePrefix: symbol.referencePrefix || config.ref,
      description:
        symbol.description ?? `${config.name} symbol imported from KiCad`,
      provenance: provenance(
        "kicad-sym",
        path.basename(args.symbol),
        path.basename(args.symbol, ".kicad_sym"),
        symbol.name,
        symbolHash,
        convertedAt,
      ),
      parser: {
        warnings: parsedSymbols.symbols[0].warnings,
        properties: parsedSymbols.symbols[0].properties,
        units: parsedSymbols.symbols[0].units,
      },
      normalized: symbol,
      raw: parsedSymbols.symbols[0],
    }),
    writeJson(footprintPath, {
      id: footprintId,
      uuid: generateUuid(),
      version: "1.0.0",
      name: parsedFootprint.name,
      mountType: footprint.mountType,
      models3d: [modelId],
      provenance: provenance(
        "kicad-mod",
        path.basename(args.footprint),
        path.basename(args.footprint, ".kicad_mod"),
        parsedFootprint.name,
        footprintHash,
        convertedAt,
      ),
      parser: { warnings: parsedFootprint.warnings },
      normalized: footprint,
      raw: parsedFootprint,
      sourceFileName: path.basename(args.footprint),
    }),
    writeJson(componentPath, {
      id: componentId,
      uuid: generateUuid(),
      version: "1.0.0",
      name: config.name,
      description: `${config.name} imported from KiCad seed files`,
      category,
      tags: [category, "kicad-derived"],
      aliases: [],
      symbol: symbolId,
      defaultFootprint: footprintId,
      footprints: [{ footprint: footprintId, label: footprint.name, pinMap }],
      provenance: provenance(
        "openpcb-component",
        path.basename(args.symbol),
        path.basename(args.symbol, ".kicad_sym"),
        config.name,
        `${symbolHash}:${footprintHash}:${stepHash}`,
        convertedAt,
      ),
      compatibility: { minOpenPcbVersion: "0.1.0" },
    }),
    writeJson(modelPath, {
      id: modelId,
      uuid: generateUuid(),
      version: "1.0.0",
      name: `${footprint.name} STEP model`,
      formats: { step: { path: modelRel, sha256: stepHash } },
      provenance: provenance(
        "step",
        path.basename(args.step),
        path.basename(args.step, path.extname(args.step)),
        path.basename(args.step),
        stepHash,
        convertedAt,
      ),
      offsetMm: modelRef?.offset ?? { x: 0, y: 0, z: 0 },
      rotationDeg: modelRef?.rotation ?? { x: 0, y: 0, z: 0 },
    }),
  ]);
  await mkdir(path.dirname(stepPath), { recursive: true });
  await copyFile(args.step, stepPath);
  console.log(`[import-kicad] wrote ${componentId}`);
}

run(Bun.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[import-kicad] ${message}`);
  process.exit(1);
});
