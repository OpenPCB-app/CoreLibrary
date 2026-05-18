/**
 * Smoke tests against the live CoreLibrary repo — verifies that the in-mem
 * index picks up the seed content (resistor + capacitor + anything imported
 * during this dev session).
 */
import { describe, test, expect } from "bun:test";
import { getIndex, rebuildIndex } from "../index-cache";

describe("index-cache", () => {
  test("loads seed components on first read", () => {
    const idx = rebuildIndex();
    expect(idx.components.size).toBeGreaterThanOrEqual(2);
    expect(idx.symbols.size).toBeGreaterThanOrEqual(2);
    // built-ins always present
    expect(idx.components.has("openpcb.core.passive.resistor")).toBe(true);
    expect(idx.components.has("openpcb.core.passive.capacitor")).toBe(true);
  });

  test("getIndex is memoized between calls without rebuild", () => {
    const a = getIndex();
    const b = getIndex();
    expect(a).toBe(b);
  });

  test("rebuildIndex returns a fresh object", () => {
    const a = getIndex();
    const b = rebuildIndex();
    expect(b).not.toBe(a);
    expect(b.components.size).toBe(a.components.size);
  });
});
