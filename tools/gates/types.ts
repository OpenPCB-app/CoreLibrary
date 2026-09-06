/**
 * Shared shape for the numbered content gates (G6+). Each gate module exports a
 * pure function that inspects one asset (or a component with its resolved
 * symbol/footprints) and returns findings; tools/validate.ts decides how a
 * severity maps to the process exit code (`fail` always fatal, `warn` fatal
 * under --strict, `note` never fatal).
 */
export type GateSeverity = "fail" | "warn" | "note";

export interface GateFinding {
  gate: string; // e.g. "G7"
  severity: GateSeverity;
  message: string;
}

export function finding(
  gate: string,
  severity: GateSeverity,
  message: string,
): GateFinding {
  return { gate, severity, message };
}
