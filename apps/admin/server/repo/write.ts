import { writeFileSync } from "node:fs";
import { rebuildIndex } from "./index-cache";

/** Pretty-write a JSON file with stable 2-space indent + trailing newline. */
export function writeJsonFile(absPath: string, value: unknown): void {
  const body = JSON.stringify(value, null, 2) + "\n";
  writeFileSync(absPath, body, "utf8");
  rebuildIndex();
}
