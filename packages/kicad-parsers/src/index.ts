/**
 * Public surface of `@openpcb/kicad-parsers`.
 *
 * KiCad s-expression parsing primitives plus higher-level parsers for
 * `.kicad_sym` symbol libraries and `.kicad_mod` footprint files.
 *
 * Used by the OpenPCB library module (KiCad import flow + bundled-component
 * seeding) and by OpenPCB_CoreLibrary's authoring tools.
 */
export * from "./sexpr-parser";
export * from "./kicad-symbol-parser";
export * from "./kicad-footprint-parser";
