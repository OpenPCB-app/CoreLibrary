export interface LibraryManifest {
  schemaVersion: "1.0.0";
  library: {
    id: string;
    name: string;
    kind?: "core" | "user" | "team";
    channel: "stable" | "beta" | "nightly";
    version: string;
    license: string;
    homepage?: string;
    minOpenPcbVersion?: string;
    generatedAt: string;
  };
  symbols: AssetEntry[];
  footprints: FootprintEntry[];
  models3d: Model3dEntry[];
  components: ComponentEntry[];
  templates?: unknown[];
  deprecated?: unknown[];
  integrity: { algorithm: "sha256"; packageSha256: string };
  signature?: { algorithm: "ed25519"; keyId: string; signature: string };
}

export interface AssetEntry {
  id: string;
  uuid: string;
  version: string;
  name: string;
  path: string;
  sha256: string;
  license?: string;
}

export interface FootprintEntry extends AssetEntry {
  package?: { code?: string; mountType?: string; standard?: string };
  models3d?: string[];
}

export interface Model3dEntry {
  id: string;
  uuid: string;
  version: string;
  name: string;
  formats: Partial<Record<"glb" | "step", { path: string; sha256: string }>>;
  boundsMm?: { x: number; y: number; z: number };
}

export interface ComponentEntry {
  id: string;
  uuid: string;
  version: string;
  name: string;
  description?: string;
  category: string;
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
    source:
      | "openpcb-original"
      | "kicad-derived"
      | "datasheet-derived"
      | "community";
    license: string;
    attribution: string[];
    sourceFormat: string;
    sourceFileName: string;
    sourceLibrary: string;
    sourceItemName: string;
    sourceHash: string;
    upstreamUrl: string;
    upstreamCommit?: string;
    convertedAt: string;
    conversionTool: string;
  };
  compatibility?: { minOpenPcbVersion?: string };
}
