/**
 * G8 — datasheet URL vs primary manufacturer coherence. A stale copy-paste
 * during import (or a part whose manufacturer field changed after acquisition)
 * points `datasheet` at a host that doesn't belong to the primary sourced
 * manufacturer. Advisory only: an unrecognized host is a gap in this table's
 * coverage (`note`), and a genuine mismatch is `warn`, not `fail` — some
 * datasheets are legitimately mirrored by a distributor.
 *
 * Pure module — the caller (tools/validate.ts, wired later) supplies the
 * loaded component and renders the findings. Kept self-contained rather than
 * importing `ManufacturerPartEntry` from `./sourcing` — only the two fields
 * used here matter to this gate.
 */
import { finding, type GateFinding } from "./types";

export interface DatasheetHostManufacturer {
  hostSuffix: string;
  manufacturer: string;
}

/** Datasheet-hosting domain -> the manufacturer that domain belongs to. */
export const DATASHEET_HOST_MANUFACTURERS: DatasheetHostManufacturer[] = [
  { hostSuffix: "onsemi.com", manufacturer: "onsemi" },
  { hostSuffix: "ti.com", manufacturer: "Texas Instruments" },
  { hostSuffix: "st.com", manufacturer: "STMicroelectronics" },
  { hostSuffix: "nexperia.com", manufacturer: "Nexperia" },
  { hostSuffix: "vishay.com", manufacturer: "Vishay" },
  { hostSuffix: "infineon.com", manufacturer: "Infineon" },
  { hostSuffix: "microchip.com", manufacturer: "Microchip" },
  { hostSuffix: "atmel.com", manufacturer: "Microchip" },
  { hostSuffix: "diodes.com", manufacturer: "Diodes Incorporated" },
  { hostSuffix: "aosmd.com", manufacturer: "Alpha & Omega" },
  { hostSuffix: "nxp.com", manufacturer: "NXP" },
  { hostSuffix: "analog.com", manufacturer: "Analog Devices" },
  { hostSuffix: "maximintegrated.com", manufacturer: "Analog Devices" },
  { hostSuffix: "wch-ic.com", manufacturer: "WCH" },
  { hostSuffix: "wch.cn", manufacturer: "WCH" },
  { hostSuffix: "espressif.com", manufacturer: "Espressif" },
  { hostSuffix: "raspberrypi.com", manufacturer: "Raspberry Pi" },
  { hostSuffix: "hirose.com", manufacturer: "Hirose" },
  { hostSuffix: "jst.com", manufacturer: "JST" },
  { hostSuffix: "jst-mfg.com", manufacturer: "JST" },
  { hostSuffix: "molex.com", manufacturer: "Molex" },
  { hostSuffix: "we-online.com", manufacturer: "Würth" },
  { hostSuffix: "bourns.com", manufacturer: "Bourns" },
  { hostSuffix: "secosgmbh.com", manufacturer: "SECOS" },
  { hostSuffix: "centralsemi.com", manufacturer: "Central Semiconductor" },
  { hostSuffix: "aosong.com", manufacturer: "Aosong" },
  { hostSuffix: "kingbright.com", manufacturer: "Kingbright" },
  { hostSuffix: "epson.com", manufacturer: "Epson" },
  { hostSuffix: "keyelco.com", manufacturer: "Keystone" },
  { hostSuffix: "littelfuse.com", manufacturer: "Littelfuse" },
  { hostSuffix: "phoenixcontact.com", manufacturer: "Phoenix Contact" },
  { hostSuffix: "tdk.com", manufacturer: "TDK" },
  { hostSuffix: "murata.com", manufacturer: "Murata" },
  { hostSuffix: "winbond.com", manufacturer: "Winbond" },
  { hostSuffix: "ftdichip.com", manufacturer: "FTDI" },
  { hostSuffix: "wiznet.io", manufacturer: "WIZnet" },
  { hostSuffix: "amphenol-cs.com", manufacturer: "Amphenol ICC" },
  { hostSuffix: "epsondevice.com", manufacturer: "Seiko Epson" },
  { hostSuffix: "hmsemi.com", manufacturer: "HMSemi" },
  { hostSuffix: "omron.com", manufacturer: "Omron" },
  { hostSuffix: "allegromicro.com", manufacturer: "Allegro MicroSystems" },
  { hostSuffix: "bosch-sensortec.com", manufacturer: "Bosch Sensortec" },
  { hostSuffix: "cuidevices.com", manufacturer: "CUI Devices" },
  { hostSuffix: "sanyourelay.ca", manufacturer: "Sanyou Relay" },
  { hostSuffix: "toppwr.com", manufacturer: "TOPPOWER" },
  { hostSuffix: "umw-ic.com", manufacturer: "UMW" },
  { hostSuffix: "xlsemi.com", manufacturer: "XLSEMI" },
  { hostSuffix: "mdddiodes.com", manufacturer: "MDD" },
  { hostSuffix: "microdiode.com", manufacturer: "MDD" },
  { hostSuffix: "diotec.com", manufacturer: "Diotec" },
  { hostSuffix: "world-semi.com", manufacturer: "Worldsemi" },
  { hostSuffix: "global.sharp", manufacturer: "Sharp" },
  { hostSuffix: "maxlinear.com", manufacturer: "MaxLinear" },
];

/**
 * Alias groups — names that should compare equal after normalisation
 * (rebrand, acquisition, or a distributor listing under the parent brand).
 * The first entry in each group is just its canonical spelling; matching is
 * case-insensitive and order-independent.
 */
export const MANUFACTURER_ALIASES: readonly (readonly string[])[] = [
  ["onsemi", "on semiconductor", "fairchild"],
  ["stmicroelectronics", "st"],
  ["texas instruments", "ti"],
  ["nexperia"],
  ["alpha & omega", "aos"],
  ["diodes incorporated", "diodes inc"],
  ["infineon", "international rectifier", "ir"],
  ["microchip", "atmel"],
  ["analog devices", "maxim", "maxim integrated", "linear technology"],
  ["tdk", "invensense"],
  ["wch", "nanjing qinheng"],
  ["seiko epson", "epson"],
  ["toppower", "toppower (nanjing extension microelectronics)", "nanjing extension microelectronics"],
  ["umw", "umw (youtai semiconductor)", "youtai", "youtai semiconductor"],
  ["mdd", "mdd(microdiode semiconductor)", "microdiode", "microdiode semiconductor"],
  ["amphenol icc", "amphenol"],
  ["sanyou relay", "sanyou"],
  ["cui devices", "cui"],
];

function normalizeManufacturer(name: string): string {
  const lower = name.trim().toLowerCase();
  for (const group of MANUFACTURER_ALIASES) {
    if (group.includes(lower)) return group[0] ?? lower;
  }
  return lower;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function matchHost(host: string): DatasheetHostManufacturer | undefined {
  return DATASHEET_HOST_MANUFACTURERS.find(
    (entry) => host === entry.hostSuffix || host.endsWith(`.${entry.hostSuffix}`),
  );
}

interface PrimaryCandidate {
  manufacturer: string;
  role?: "primary" | "alternate";
}

function primaryManufacturer(
  parts: PrimaryCandidate[] | undefined,
): string | undefined {
  if (!parts || parts.length === 0) return undefined;
  const explicit = parts.find((p) => p.role === "primary");
  return (explicit ?? parts[0])?.manufacturer;
}

export interface DatasheetCoherenceInput {
  id: string;
  manufacturerParts?: PrimaryCandidate[];
  datasheet?: string | null;
}

export function checkDatasheetCoherence(
  component: DatasheetCoherenceInput,
): GateFinding[] {
  const { id, manufacturerParts, datasheet } = component;
  const manufacturer = primaryManufacturer(manufacturerParts);
  if (!manufacturer || !datasheet) return [];

  const host = hostOf(datasheet);
  if (!host) return [];

  const match = matchHost(host);
  if (!match)
    return [
      finding(
        "G8",
        "note",
        `${id} datasheet host '${host}' is not in the known manufacturer-host table`,
      ),
    ];

  if (normalizeManufacturer(match.manufacturer) === normalizeManufacturer(manufacturer))
    return [];

  return [
    finding(
      "G8",
      "warn",
      `${id} datasheet host '${host}' belongs to '${match.manufacturer}' but the primary manufacturer is '${manufacturer}'`,
    ),
  ];
}
