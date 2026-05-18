import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { SCHEMAS_DIR } from "./paths";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv as never);

function compile(name: string): ValidateFunction {
  const schema = JSON.parse(
    readFileSync(path.join(SCHEMAS_DIR, `${name}.schema.json`), "utf8"),
  );
  return ajv.compile(schema);
}

export const validateSymbol = compile("symbol");
export const validateFootprint = compile("footprint");
export const validateComponent = compile("component");

export function ajvFailReason(v: ValidateFunction): string {
  if (!v.errors) return "unknown";
  return v.errors
    .map((e) => `${e.instancePath || "/"} ${e.message}`)
    .join("; ");
}
