export interface LibraryPinMapEntry {
  pinNumber: string;
  padNumber: string;
  pinName: string | null;
}

interface SymbolPinLike {
  readonly number: string | null | undefined;
  readonly name?: string | null | undefined;
}

interface SymbolLike {
  readonly pins: readonly SymbolPinLike[];
}

interface FootprintPadLike {
  readonly number?: string | null | undefined;
}

interface FootprintLike {
  readonly pads: readonly FootprintPadLike[];
}

export function buildIdentityPinMap(
  symbol: SymbolLike,
  footprint: FootprintLike,
): LibraryPinMapEntry[] {
  const padNumbers = new Set(
    footprint.pads
      .map((pad) => (pad.number ?? "").trim())
      .filter((number) => number.length > 0),
  );
  const entries: LibraryPinMapEntry[] = [];

  for (const pin of symbol.pins) {
    const pinNumber = (pin.number ?? "").trim();
    if (!pinNumber || !padNumbers.has(pinNumber)) {
      continue;
    }
    entries.push({
      pinNumber,
      padNumber: pinNumber,
      pinName: pin.name ?? null,
    });
  }

  return entries;
}

export function buildIdentityPinMapJson(
  symbol: SymbolLike,
  footprint: FootprintLike,
): string | null {
  const entries = buildIdentityPinMap(symbol, footprint);
  return entries.length > 0 ? JSON.stringify(entries) : null;
}
