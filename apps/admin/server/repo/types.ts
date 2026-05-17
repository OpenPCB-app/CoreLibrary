export interface SymbolFile {
  id: string;
  uuid: string;
  version: string;
  name: string;
  referencePrefix?: string;
  description?: string;
  provenance?: Record<string, unknown>;
  parser?: Record<string, unknown>;
  normalized?: {
    pins?: unknown[];
    preview?: Record<string, unknown>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface FootprintFile {
  id: string;
  uuid: string;
  version: string;
  name: string;
  mountType?: string;
  package?: { code?: string; mountType?: string; standard?: string };
  models3d?: string[];
  provenance?: Record<string, unknown>;
  parser?: Record<string, unknown>;
  normalized?: {
    pads?: unknown[];
    preview?: Record<string, unknown>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface ComponentFile {
  id: string;
  uuid: string;
  version: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  aliases?: string[];
  symbol: string;
  defaultFootprint: string;
  footprints: Array<{
    footprint: string;
    label: string;
    pinMap?: Array<{ pinNumber: string; padNumber: string; pinName?: string }>;
  }>;
  parameters?: Record<string, unknown>;
  manufacturerParts?: Array<{ manufacturer: string; mpn: string }>;
  provenance: {
    source: string;
    license: string;
    attribution?: string[];
    notes?: string;
  };
  compatibility?: { minOpenPcbVersion?: string };
}

export interface Model3dEntry {
  /** filename without extension (e.g. "r-0603") */
  slug: string;
  category: string;
  glbAbsPath: string;
  glbRelPath: string;
  /** referencing footprint ids (via models3d field) */
  referencedBy: string[];
}

export interface IndexedComponent {
  file: ComponentFile;
  absPath: string;
  category: string;
}

export interface IndexedSymbol {
  file: SymbolFile;
  absPath: string;
  category: string;
}

export interface IndexedFootprint {
  file: FootprintFile;
  absPath: string;
  category: string;
}
