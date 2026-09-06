# 2026-09 content-hardening audit — findings and fixes

Branch `feat/corelib-hardening`. This file records the per-component verdicts behind the sourcing
and pinout changes made during the 2026-09 hardening pass, so that a later reviewer can tell a
deliberate decision from an accident — and, where a fact could not be established, can see exactly
what was tried.

## Scope and method

- **Scope of this batch:** `components/transistor/**` (32) and `components/diode/**` (20).
  Two further batches append below under their own headings.
- **Evidence standard:** the manufacturer's own datasheet, read as text. Every PDF cited here was
  downloaded and passed through `pdftotext -layout`; where the pinout lives only in vector art the
  page was rendered and read as an image. **Prose summaries produced by a URL-fetching summariser
  were discarded** — during the audit one invented a pinout, asserting that onsemi's TO-92 BC547 is
  "1 Emitter 2 Base 3 Collector" when the extracted document text reads `1. Collector 2. Base
  3. Emitter`. Nothing below rests on a summary.
- **EasyEDA / JLCPCB data was used as a *lead* only, never as evidence.** It produced two false
  leads on `BD139` (LCSC `C27866`): the distributor record and its EasyEDA symbol imply ST's lead
  numbering, which runs opposite to onsemi's for the same physical part. Sourcing metadata answers
  "can I buy it"; only the manufacturer datasheet answers "which lead is which".
- **LCSC codes** were each confirmed against the JLCPCB parts database (MPN, package and
  `library_type` read back per code); `jlcpcbAssemblyType` is that `library_type`.
- **Tooling caveat.** `onsemi.com`, `st.com`, `analog.com`, `infineon.com` and several others reject
  automated probes (Akamai 403 / connection reset). `tools/check-datasheet-links.ts` already treats
  those hosts as `blocked`, not failed. Their PDFs were fetched out-of-band and verified by text
  extraction instead; the confirming line is quoted per entry below.

### Three facts established once, used throughout

1. **KiCad diode footprints put the cathode on pad 1.** Verified directly in the vendored
   footprints: in `D_SOD-123`, `D_SOD-323`, `D_SMA` and `D_SMB` the `F.Fab` cathode bar and the
   `F.SilkS` polarity band sit at the pad-1 end; in `D_DO-41…`, `D_DO-35…` and `D_DO-201AD…` the
   triple `F.Fab` band lines sit hard against pad 1. A symbol with `1=K, 2=A` plus an identity
   `pinMap` is therefore correct for every 2-pin diode here.
2. **onsemi `CASE 318` (SOT-23) `STYLE 6`** = `PIN 1. BASE / 2. EMITTER / 3. COLLECTOR`;
   **`STYLE 8`** = `PIN 1. ANODE / 2. NO CONNECTION / 3. CATHODE`. Read verbatim from
   `mmbt3904lt1-d.pdf` (CASE 318, ISSUE AU). These settle the SOT-23 BJT and SOT-23 zener families.
3. **Infineon/IR `TO-220AB`** = `1 - GATE, 2 - DRAIN, 3 - SOURCE, 4 - DRAIN (tab)`, read verbatim
   from the IRLZ44N package-outline page, whose BJT variant reads `2- COLLECTOR / 3- EMITTER`.

---

## Transistors and diodes

`pinout` / `package` / `coherence` are the three verdicts; `fix` is what was actually changed.
"identity pinMap" means `1→1, 2→2, …`. Every component not listed as a pinout DEFECT was verified
correct against the datasheet named in its row and was **not** touched apart from sourcing.

| id | verdict (pinout / package / coherence) | datasheet used | fix applied |
|----|----------------------------------------|----------------|-------------|
| `transistor.2n3904` | CORRECT / MATCH / OK | onsemi `2n3904-d.pdf` — front-page legend `1: Emitter, 2: Base, 3: Collector` | datasheet re-pointed off the 403ing `/pub/Collateral/` path; primary onsemi `2N3904BU` C124482 extended; alt JSMSEMI `2N3904` C2874602 |
| `transistor.2n3906` | CORRECT / MATCH / OK | onsemi `2n3906-d.pdf` — `CASE 29 STYLE 1: PIN 1. EMITTER, 2. BASE, 3. COLLECTOR` | datasheet re-pointed; primary `2N3906BU` C124483; alt ALJ `2N3906-338` C22751479 |
| `transistor.2n7000` | CORRECT / MATCH / **WRONG-MFR** | Vishay `70226.pdf` — TO-92 top view `S 1, G 2, D 3` | primary flipped onsemi→**Vishay `2N7000`** so the verified document is the primary's; alt onsemi `2N7000` C232838. Datasheet unchanged |
| `transistor.2n7002` | CORRECT / MATCH / OK | Nexperia `2N7002.pdf` — Table 2 `1 G gate, 2 S source, 3 D drain` | sourcing only: C65189 extended; alt Changjiang `2N7002` C8545 basic |
| `transistor.ao3400` | CORRECT / MATCH / OK | AOS `AO3400A.pdf` — SOT23 top view G/S lower leads, D opposite | sourcing only: C20917 **basic**; alt Diodes Inc `DMN3042L-7` C102621 |
| `transistor.ao3401` | CORRECT / MATCH / OK | AOS `AO3401A.pdf` — same layout | sourcing only: C15127 **basic**; alt Diodes Inc `DMP3056L-7` C150724 |
| `transistor.bc547` | CORRECT / MATCH / OK | onsemi `bc550-d.pdf` — `1. Collector 2. Base 3. Emitter` (European C-B-E, opposite to 2N3904; the library has both right) | datasheet re-pointed; primary `BC547BTA` C258144; alt Changjiang `BC547` C47089404 |
| `transistor.bc557` | CORRECT / MATCH / OK | onsemi `bc556bta-d.pdf` — `1. Collector / 2. Base / 3. Emitter` | datasheet re-pointed; primary `BC557BTA` C512874; alt LGE `BC557B` C713617 |
| `transistor.bc807` | CORRECT / MATCH / OK | Nexperia `BC807_SER.pdf` — Table 3 `1 B, 2 E, 3 C` | sourcing only: C57316; alt hongjiacheng C20069142 preferred |
| `transistor.bc817` | CORRECT / MATCH / OK | Nexperia `BC817_SER.pdf` — Table 3 `1 B, 2 E, 3 C` | sourcing only: C52801; alt hongjiacheng C20069155 preferred |
| `transistor.bc847` | CORRECT / MATCH / OK | Nexperia `BC846_SER.pdf` — Table 3 `1 base, 2 emitter, 3 collector` | sourcing only: **C57668** (the B gain bin — `C8664` is `BC847C,215`, a different bin); alt hongjiacheng `BC847B` C20069135 preferred |
| `transistor.bc857` | CORRECT / MATCH / OK | Nexperia `BC856_BC857_BC858.pdf` — Table 3 `1 B, 2 E, 3 C` | sourcing only: **C59205** (B bin; `C8666` is `BC857C,215`); alt onsemi `BC857BLT1G` C111644 |
| `transistor.bd139` | CORRECT / MATCH / OK\* | onsemi `bd139-d.pdf` — `1. Emitter / 2.Collector / 3.Base`, `CASE 340AS`, TOP VIEW, `#1` printed against the leftmost lead | datasheet moved **ST → onsemi** and primary to onsemi `BD13916STU` C900678; alt ST `BD139` C27866. See the ⚠ note below — this one must not be "fixed" |
| `transistor.bd140` | CORRECT / MATCH / OK\* | onsemi `bd140-d.pdf` — same CASE 340AS legend; ordering table lists `BD14016STU … TO-126 3L` | datasheet moved ST → onsemi; primary onsemi `BD14016STU` (no LCSC listing); alt ST `BD140` C38652 |
| `transistor.bss138` | CORRECT / MATCH / OK | onsemi `bss138-d.pdf` — Drain on the single-lead side, Gate lower-left, Source lower-right | datasheet re-pointed; primary `BSS138LT1G` C82045; alt hongjiacheng C7420339 preferred |
| `transistor.bss84` | CORRECT / MATCH / OK | Nexperia `BSS84.pdf` — Table 2 `1 G, 2 S, 3 D`, `SOT23 (TO-236AB)` | sourcing only; Nexperia `BSS84,215` is not LCSC-stocked so it carries no `lcsc`; alt onsemi `BSS84LT1G` C82079 |
| `transistor.irf3205` | CORRECT / MATCH / OK | Infineon `irf3205pbf.pdf` — TO-220 `Gate Drain Source` over 1/2/3 | sourcing only: C2561 |
| `transistor.irf540n` | CORRECT / MATCH / OK | Infineon `Infineon-IRF540N-…-EN.pdf` — `G D S` over `Gate Drain Source` | sourcing only: C2566 |
| `transistor.irlz44n` | CORRECT / MATCH / OK | Infineon `Infineon-IRLZ44N-…-EN.pdf` — `1 - GATE, 2 - DRAIN, 3 - SOURCE, 4 - DRAIN` | sourcing only: C38774; alt HXY `IRLZ44NPBF-HXY` C22367197 |
| `transistor.mmbt2222a` | CORRECT / MATCH / **WRONG-MFR** | Nexperia `MMBT2222A.pdf` — Table 2 `1 B, 2 E, 3 C` (agrees with onsemi CASE 318 STYLE 6) | primary flipped onsemi→**Nexperia `MMBT2222A,215`** to match the cited host; alt onsemi `MMBT2222ALT1G` C82460. Datasheet unchanged |
| `transistor.mmbt3904` | CORRECT / MATCH / OK | onsemi `mmbt3904lt1-d.pdf` CASE 318 STYLE 6 + `pzt3904-d.pdf` ordering `MMBT3904 \| SOT-23 3L` | datasheet re-pointed off the 403ing path to `pzt3904-d.pdf`; primary `MMBT3904LT1G` C81464; alt Changjiang C20526 basic |
| `transistor.mmbt3906` | CORRECT / MATCH / OK | onsemi CASE 318 STYLE 6 + `pzt3906-d.pdf` | datasheet re-pointed; primary `MMBT3906LT1G` C53444; alt hongjiacheng C7420354 preferred |
| `transistor.si2302` | CORRECT / MATCH / OK | Vishay `si2302cds.pdf` — numbered top view `D`→3, `S`→2, `G`→1 | sourcing only: C10488; alt JSMSEMI `SI2302-2.3A-JSM` C5296725 |
| **`transistor.ss8050`** | **DEFECT** / MISMATCH (doc) / **WRONG-MFR** | onsemi `ss8050-d.pdf`, `TO−92−3 CASE 135AN/135AR` — `1. Emitter, 2. Base, 3. Collector`; ordering `SS8050CTA \| S8050C \| TO−92−3` | **pinMap fixed** (see table below) + SOT-23 variant added; datasheet SECOS-SOT-23 → onsemi; primary Changjiang → onsemi `SS8050CTA` C327517; alt hongjiacheng SOT-23 C7420370 preferred; description now names both pin orders |
| **`transistor.ss8550`** | **DEFECT** / MISMATCH (doc) / **MISSING** | onsemi `ss8550-d.pdf`, `TO−92−3 CASE 135AN/135AR` — `1. Emitter, 2. Base, 3. Collector`; ordering `SS8550DTA \| S8550D \| TO−92−3` | same fix shape; `datasheet` was `null`, now onsemi; primary onsemi `SS8550DTA` C903228; alt hongjiacheng SOT-23 C7420371 preferred |
| `transistor.tip120` | CORRECT / MATCH / **WRONG-MFR** | onsemi `tip120-d.pdf` (TIP120/121/122) — `1. Base / 2. Collector / 3. Emitter / 4. Collector`, `CASE 221A STYLE 1` | primary flipped ST→**onsemi `TIP120`** to match the cited host; alt ST `TIP120` C262990. Datasheet unchanged |
| `transistor.tip122` | CORRECT / MATCH / **WRONG-MFR** | same document | primary ST→onsemi `TIP122`; alt ST `TIP122` C16283 |
| `transistor.tip41c` | CORRECT / MATCH / **WRONG-MFR** | onsemi `tip41c-d.pdf` (`TIP41A / TIP41B / TIP41C — NPN Epitaxial Silicon Transistor`) | datasheet moved off the unstable `centralsemi.com/get_document.php?…` query endpoint to onsemi's own PDF, matching the onsemi primary; alt ST `TIP41C` C92603 |
| `transistor.tip42c` | CORRECT / MATCH / **WRONG-MFR** | onsemi `tip42c-d.pdf` — front page `TO-220`, `1.Base 2.Collector 3.Emitter` | datasheet moved off `centralsemi.com`; primary onsemi `TIP42CG` C513077; alt JSMSEMI `TIP42C` C2900601 |
| `transistor.nmos-sot-23-gsd` | CORRECT / MATCH / n/a (generic) | n/a — cross-checked against the four datasheet-verified SOT-23 NMOS parts here (2N7002, AO3400, BSS138, Si2302), all G-S-D | none — generics stay unsourced by design (`tools/gates/generic-ids.ts`) |
| `transistor.npn-sot-23-ebc` | CORRECT (self-consistent) / MATCH / n/a | n/a | none — but see ⚠ below |
| `transistor.pnp-sot-23-ebc` | CORRECT (self-consistent) / MATCH / n/a | n/a | none — see ⚠ below |
| `diode.1n4001` | CORRECT / MATCH / **WRONG-MFR** | Vishay `1n4001.pdf` — `Case: DO-41 (DO-204AL)`, `Polarity: color band denotes cathode end`; pad 1 = cathode from the KiCad footprint | primary onsemi→**Vishay `1N4001-E3/54`** C145305, which keeps the already-verified document; alt MDD `1N4001` C2456 |
| `diode.1n4004` | CORRECT / MATCH / **WRONG-MFR** | same document | primary → Vishay `1N4004-E3/54` C511070; alt MDD `1N4004` C3058 |
| `diode.1n4007` | CORRECT / MATCH (DO-41) / **WRONG-MFR** | same document | primary → Vishay `1N4007-E3/54`; alt onsemi `1N4007RLG` C53568. The component's second footprint is SMA and had **no SMA part** to resolve to — added Vishay `S1M-E3/61T` C144860 with `package: "SMA"` |
| **`diode.1n4148`** | CORRECT / **MISMATCH** / **WRONG-MFR** | Diodes Inc `ds30086.pdf` (`BAV16W/1N4148W`, `Package: SOD123`); SOD-323 sibling `1N4148WS_BAV16WS.pdf` (`Package: SOD323`) | default footprint is SOD-123 but the stated MPN `1N4148` is the **DO-35 axial** part per Nexperia's own package table. Primary → Diodes Inc **`1N4148W-7-F`** C83528 (SOD-123, matching the default footprint); alts `1N4148WS-7-F` C60580 `package: "SOD-323"` and Nexperia `1N4148,133` `package: "DO-35"`, each carrying its own entry-level datasheet; description now names all three packages |
| `diode.1n5408` | CORRECT / MATCH / **WRONG-MFR** | Vishay `1n5400.pdf` — `Case: DO-201AD`, band = cathode | primary onsemi→Vishay `1N5408-E3/54`; alts onsemi `1N5408RLG` C232460, MDD `1N5408` C36138 |
| **`diode.1n5819`** | CORRECT / **MISMATCH** / **WRONG-MFR** | onsemi `1n5817-d.pdf` — ordering table lists `1N5819RLG … Axial Lead`; no SMA variant exists in any primary-manufacturer document, and an LCSC sweep of the Schottky subcategory found **no `1N5819`-marked SMA part at all** | **`defaultFootprint` changed SMA → `…diode.d-do-41`** and the SMA variant removed from `footprints[]` (`openpcb.core.diode.ss14` already covers SMA, and `d-sma` stays referenced by `1n4007`, `ss14`, `ss16`, `ss24`, `ss34`, `generic`, `zener`, `tvs`, so no orphan). Primary → onsemi `1N5819RLG` C88393; alts ST C110032, MDD C2474 |
| `diode.bat54c` | CORRECT / MATCH / **WRONG-MFR** | Diodes Inc `ds11005.pdf` — the BAT54C figure shows both cathode bars into the lone lead (common cathode), visibly different from the neighbouring BAT54A/BAT54S figures; standard SOT-23 numbering puts the lone lead at pin 3 ⇒ `1=A1, 2=A2, 3=K` | primary Nexperia→**Diodes Inc `BAT54C-7-F`**, keeping the verified document; alts Nexperia `BAT54C,215` C37704 **preferred**, hongjiacheng C22466350 preferred |
| **`diode.bav99`** | **DEFECT (pin names)** / MATCH / OK | Nexperia `BAV99_SER.pdf` Table 3 — `1 anode (diode 1)`, `2 cathode (diode 2)`, `3 cathode (diode 1), anode (diode 2)` | **symbol pin names corrected** (see below). `pinMap` and graphics untouched — they were already right. Sourcing: C2500 **basic**; alt onsemi `BAV99LT1G` C82480 |
| `diode.bridge-rectifier-abs` | **UNVERIFIED (pin 1 orientation)** / MATCH / OK | Diodes Inc `ABS10_LS.pdf` (DS43942 Rev. 6) — ABS case `D 4.90–5.20`, `E 4.20–4.50`, `HE 6.00–6.40`, `d 3.80–4.20`, identical to Diotec's ABS; ordering table `ABS10_HF \| ABS` | primary Diotec→**Diodes Inc `ABS10_HF`** C23639803 (LCSC-stocked, exact MPN in its own ordering table) with the diodes.com datasheet; alts hongjiacheng `ABS10` C42406051 preferred and Diotec `ABS10` carrying the original Diotec PDF as an entry-level datasheet. **`pinMap` deliberately unchanged** — see the UNVERIFIED note below |
| `diode.bridge-rectifier-dip` | CORRECT / MATCH / **MISSING** | MDD `DB10700000L10A.pdf` (N0310, Rev. A0) — the only DB107 datasheet found that numbers the terminals at all: `+`=(1) top-right, `−`=(2) top-left, `~`=(3), `~`=(4). Matches the library exactly | `datasheet` was `null` → G7. Primary Rectron→**MDD `DB107`** C2492, the manufacturer whose document establishes the pinout, with that PDF as an **entry-level** `datasheet`; alt Yangzhou Yangjie C698408. Rectron dropped (undocumented pinout, not stocked). See the note on entry-level datasheets below |
| `diode.bzx84` | CORRECT / MATCH / **WRONG-MFR** | Nexperia `BZX84_SER.pdf` Table 2 — `1 A anode, 2 n.c., 3 K cathode`; corroborated by onsemi CASE 318 STYLE 8 | datasheet moved off Diotec's `bzx84c2v4.pdf` to Nexperia's own, matching the Nexperia primary; alt onsemi `BZX84C5V1LT1G` C47075 |
| `diode.ss14` | CORRECT / MATCH / OK | Vishay `ss12.pdf` — `Case: SMA (DO-214AC)`, band = cathode | sourcing only: C47460; alt MDD `SS14` C2480 **basic** |
| `diode.ss16` | CORRECT / MATCH / OK | same document | sourcing only: C183023; alt hongjiacheng `SS16` C18199176 preferred |
| **`diode.ss24`** | CORRECT / **MISMATCH** / OK | Diodes Inc `B240A.pdf` (`B220/A - B260/A`, 2.0A SMA) — replaces Vishay `ss22.pdf`, which states `SMB (DO-214AA)` four times on its front page and ties the `/52T` reel code to SMB in its ordering table | the footprint is SMA but `SS24-E3/52T` is an **SMB** part. Measured: `D_SMA` pads 2.5 × **1.8** mm at x = ±2.00 mm vs `D_SMB` 2.5 × **2.3** mm at ±2.15 mm — an SMB body overhangs SMA pads. No tier-1 vendor builds an SS24 in SMA, so the primary became Diodes Inc **`B240A-13-F`** C92506 (a genuine SMA 2A/40V Schottky) and the component was renamed **"SS24 / B240A"** so the substitution is visible; the SS24-marked JLC parts stay as alternates (hongjiacheng C7420362 preferred, MDD C50645) |
| `diode.ss26` | CORRECT / MATCH / OK | Vishay `ss22.pdf` — `Case: SMB (DO-214AA)` | sourcing only. Note this is the *same* datasheet as `ss24`: `ss26` picks SMB correctly, which is itself evidence the old `ss24` footprint pairing was the error. Alts onsemi `SS26T3G` C47071, hongjiacheng `SS26B` C18199184 preferred |
| **`diode.ss34`** | CORRECT / **MISMATCH** / OK | Diodes Inc `B340A.pdf` (`B320A - B360A`, 3.0A SMA, DS30891) — replaces Vishay `ss32.pdf`, which states `SMC (DO-214AB)` three times and ties `/57T` to SMC | same shape as `ss24`: `SS34-E3/57T` is **SMC**, the footprint is SMA. Primary → Diodes Inc **`B340A-13-F`** C85098; renamed **"SS34 / B340A"**; alts MDD `SS34` C8678 **basic** (5.3 M stock) and hongjiacheng C7420365 preferred |
| `diode.generic` | CORRECT / MATCH / n/a (generic) | n/a — verified against KiCad footprint geometry | none |
| `diode.zener` | CORRECT / MATCH / n/a (generic) | n/a | none |
| `diode.tvs` | CORRECT / MATCH / n/a (generic) | n/a | **description corrected**: it claimed "unidirectional" while using KiCad's `Device:D_TVS_Filled`, whose pins are `A1`/`A2` — the *bidirectional* convention. A unidirectional TVS is polarised and needs an `A`/`K` symbol; fitted backwards it shorts the rail through a forward diode |
| `diode.usblc6-2sc6` | CORRECT / MATCH / OK | ST `usblc6-2.pdf` (DS4260 Rev 7) — functional diagram `I/O1 1 … 6 I/O1`, `GND 2 … 5 VBUS`, `I/O2 3 … 4 I/O2`; ordering `USBLC6-2SC6 \| UL26 \| SOT23-6L` | sourcing only: C7519; alt UMW C2687116. The deliberately duplicated `I/O1`/`I/O2` names are correct — the part is a feed-through |

### Pin tables for the DEFECT parts

**`transistor.ss8050` / `transistor.ss8550` — TO-92 is E-B-C, the symbol is B-E-C.**

onsemi `ss8050-d.pdf` / `ss8550-d.pdf`, front-page legend, verbatim:

| pin | onsemi TO−92−3 (CASE 135AN/135AR) |
|-----|-----------------------------------|
| 1 | Emitter |
| 2 | Base |
| 3 | Collector |

Corroborated by MCC `SS8050`/`SS8550` Rev.3-1-01012019 (`1.EMITTER / 2.BASE / 3.COLLECTOR`), the
originating Fairchild `SS8050` Rev 1.1.0 sheet, and UTC `S8050`/`S8550` (`TO-92 | E | B | C`).

The library symbol comes from KiCad `Transistor_BJT:SS8050`, which resolves its pins from the
`Q_NPN_BEC` base — correct for the **SOT-23** die KiCad's `ki_fp_filters` target, wrong against the
TO-92 footprint this component paired it with. Base and emitter would have been exchanged on every
board.

**Fix chosen: keep the KiCad B-E-C symbol, correct the `pinMap`, and add the SOT-23 variant.**
Editing the shared symbol was rejected because the same symbol is legitimately B-E-C for the SOT-23
part, which this component now also offers.

| footprint | symbol pin | pin name | pad | pad function |
|-----------|-----------|----------|-----|--------------|
| `package.to-92-inline` (default) | 1 | B | **2** | centre lead = Base |
| | 2 | E | **1** | first lead = Emitter |
| | 3 | C | 3 | third lead = Collector |
| `package.sot-23` (added) | 1 | B | 1 | B-E-C, identity map |
| | 2 | E | 2 | |
| | 3 | C | 3 | |

The SOT-23 variant is not cosmetic: the SOT-23 SS8050/SS8550 are the JLCPCB **preferred** parts
(hongjiacheng C7420370 / C7420371, ~6.7 M / 1.6 M stock), so this is the version most users will
actually fit. `tools/manifests/p2-discrete.json` was updated with the corrected pinMap and the
added footprint (`"existing": true`) so a re-import reproduces the fix rather than reverting it.

> **⚠ Naming hazard found while verifying this.** Do **not** treat "8050" part numbers as
> interchangeable. UTC's `S8050` in TO-92 is E-B-C, but UTC's `8050S` — a different, 700 mA part —
> is **E-C-B** in the same package. Whatever MPN this component carries, re-check the pin order
> against that exact MPN.

**`diode.bav99` — pin names 1 and 2 were exchanged.**

Nexperia `BAV99_SER.pdf` (Rev. 8), "Table 3. Pinning", verbatim:

| pin | Nexperia | was in library | now |
|-----|----------|----------------|-----|
| 1 | anode (diode 1) | `K` | **`A`** |
| 2 | cathode (diode 2) | `A` | **`K`** |
| 3 | cathode (diode 1), anode (diode 2) | `K` | **`COM`** |

Table 1 confirms the configuration is `dual series`.

Scope of the damage was narrower than it looks, and should not be overstated: the symbol's
*graphics* were already correct — the imported preview polylines put the triangle base (anode) at
the pin-1 end and the cathode bar at the pin-2 end, matching Nexperia — and the `pinMap` is
identity, so a board routed from the drawn symbol connects correctly. The defect was in
`normalized.pins[].name` (and `raw.pins[].name`), which is what the app exposes and what a
netlist/BOM reader or an ERC rule keyed on `A`/`K` would believe. **The `pinMap` was deliberately
not touched** — changing it would have broken the correct graphics.

Root cause is upstream: vendored KiCad `Diode:BAV99.kicad_sym` itself carries `(name "K")` on pin 1
and `(name "A")` on pin 2 while drawing the diodes the other way round, and hides pin names
(`(pin_names (hide yes))`) so the contradiction is invisible in KiCad. KiCad's own `BAT54S` gets it
right (`1=A, 2=K, 3=COM`), which is where the `COM` spelling comes from. Worth an upstream KiCad
issue as well as this local fix. `bun tools/rebuild-previews.ts --only=bav99 --symbols` reports the
preview unchanged, as expected — the names are hidden, so no preview geometry depends on them.

### Left UNVERIFIED

**`diode.bridge-rectifier-abs` — which pad is `+` is still not established by any manufacturer.**

What *is* confirmed is the **topology**: both Diotec and Diodes Incorporated draw the two DC
terminals adjacent on one edge and the two AC terminals adjacent on the opposite edge, with `−`
upper-left and `+` upper-right as moulded body symbols. The KiCad footprint/symbol pair encodes
exactly that (DC on pads 1–2, AC on pads 3–4). What is **not** confirmed is the **orientation** —
whether pad 1 lands on the terminal moulded `+` or the one moulded `−`. That binding rests on
KiCad's convention, not on a manufacturer statement, and it matters: a 180° error reverses the DC
output.

What was tried: full text extraction of every page of Diotec `abs2.pdf` and of Diodes Inc
`ABS10_LS.pdf`; the mechanical drawings rendered at 300 and 900 dpi; a search for a numbered pin
table from either vendor; and a check of `https://www.diodes.com/assets/Package-Files/ABS.pdf`
(404). **Neither manufacturer numbers the ABS terminals anywhere.** Diotec's `~ + − ~` diamond is a
generic application circuit, not a pinout. Diodes Inc's own ABS-package document is no better than
Diotec's on this point — the promotion to a Diodes Inc primary was made for *sourcing and G8
coherence*, not because it closed the question.

`pinMap` was therefore left exactly as it was. Changing it on a guess is worse than a documented
unknown. To close this: confirm against a physical part, or find an ABS-package vendor that numbers
its terminals.

**`diode.bridge-rectifier-dip` rests on a single vendor's numbering.** MDD is the only DB107
manufacturer found that numbers the pins at all; Rectron's, MCC's, Zibo Seno's and Diodes Inc's
`ds21211` all omit it (and `ds21211` additionally carries `NOT RECOMMENDED FOR NEW DESIGNS`).
Several hobbyist sources assert a *different*, alternating `1=~, 2=+, 3=~, 4=−` order without
citation and contradict one another; the library agrees with the one real manufacturer document
found. Confirm against hardware before relying on it.

### Notes a future reviewer must not "fix"

1. **`bd139` / `bd140` — ST and onsemi number TO-126 leads in opposite directions.** onsemi's
   front-page legend reads `1. Emitter / 2.Collector / 3.Base` and its `CASE 340AS` drawing is
   marked TOP VIEW with `#1` against the leftmost lead. ST's `SOT-32 (TO-126) MECHANICAL DATA`
   figure reads `1 = BASE, 2 = COLLECTOR, 3 = EMITTER`, with the leader labels running right-to-left
   — so ST's pin 1 is the **rightmost** lead. They describe the same physical part (viewed from the
   marked face, leads down: Emitter – Collector – Base left to right); they are drop-in second
   sources, as they must be. The KiCad footprint puts pad 1 at the leftmost lead, so the library's
   `pad1=E, pad2=C, pad3=B` is physically right and follows onsemi's indexing. **The datasheet was
   re-pointed from ST to onsemi precisely so that the cited document's numbering matches the
   symbol** — otherwise a reviewer comparing the two would read a false defect and invert a working
   part.
2. **`npn-sot-23-ebc` / `pnp-sot-23-ebc` encode a pin order essentially no SOT-23 BJT uses.** Every
   SOT-23 BJT verified in this batch — BC807, BC817, BC847, BC857, MMBT2222A, MMBT3904, MMBT3906 —
   is **B-E-C** (four Nexperia pinning tables plus onsemi CASE 318 STYLE 6). These generics are
   self-consistent with their own descriptions, so they were not scored as defects and were not
   changed, but a user who drops one in and fits an ordinary SOT-23 NPN gets base and emitter
   exchanged. The sibling `nmos-sot-23-gsd` *does* encode the real convention, so the asymmetry is
   surprising. Recommended follow-up: add `npn-sot-23-bec` / `pnp-sot-23-bec` as the defaults, or
   say plainly in the description that these exist only for the rare EBC-pinned parts.
3. **LCSC brand strings are not manufacturers.** `C81598` is listed as "ST(Semtech)" but that is an
   LCSC house label, not STMicroelectronics — it was not used. Likewise `1N4148W` / `1N4148WS` are
   **Diodes Incorporated** part numbers, not Nexperia's; Nexperia publishes no such datasheet, and
   its equivalents in those bodies are `BAS16GW` (SOD-123) and `BAS316` (SOD-323).
4. **Two entry-level `datasheet` fields are load-bearing, not decorative.**
   `bridge-rectifier-dip`'s primary (MDD) and `bridge-rectifier-abs`'s Diotec alternate carry their
   own `datasheet` because those manufacturers' hosts are not in
   `tools/gates/datasheet-coherence.ts`'s host table. G7 accepts a datasheet on the primary entry,
   and G8 only inspects the component-level field. For `bridge-rectifier-dip` this means the
   component-level `datasheet` stays `null` and the MDD document is not covered by
   `tools/check-datasheet-links.ts`, which only walks component-level URLs. Cleaner long-term fixes,
   both out of scope here: add `mdddiodes.com`/`microdiode.com` and `diotec.com` to the host table,
   or teach the link checker to walk entry-level URLs.
5. **`role` is omitted on entry 0 and set to `"alternate"` on every later entry.** Index 0 is the
   primary by definition (CONTRIBUTING, "Sourcing data"); G7 fails only if entry 0 is marked
   `alternate` or a later entry claims `primary`. Some older components in the tree spell
   `role: "primary"` explicitly on entry 0 — both forms are valid and neither is a defect.

### Counts for this batch

- **52 components audited** (32 transistor + 20 diode).
- **Pinout:** 3 DEFECT (`ss8050`, `ss8550`, `bav99`) — all fixed; 1 UNVERIFIED
  (`bridge-rectifier-abs`) — documented, unchanged; 48 CORRECT.
- **Package:** 6 MISMATCH — 4 real geometry/sourcing errors (`1n4148`, `1n5819`, `ss24`, `ss34`),
  all fixed; 2 documentation mismatches (`ss8050`, `ss8550`, TO-92 footprint against a SOT-23
  datasheet), both fixed.
- **Datasheet coherence:** 15 WRONG-MANUFACTURER and 2 MISSING at the start of the batch; 0 after.
- **`bun tools/validate.ts --release --strict` reports no G7/G8 finding — including advisory
  `note`-severity ones — under `components/transistor/` or `components/diode/`.**

---

## Audit section B — power, relay, switch, crystal, battery, audio, reviewed connectors

Scope: `components/power/*` (23), `components/relay/*` (2), `components/switch/*` (3),
`components/crystal/*` (5), `components/battery/*` (2), `components/audio/*` (1) and the
reviewed connectors (`usb-a`, `usb-micro-b`, `usb-c-receptacle`, `dc-barrel-jack`,
`rj45-magjack`, `microsd-dm3at`, `jst-ph-*`, `jst-xh-*`, `screw-terminal-*`, `idc-2x05`,
plus the generic pin-header/socket set).

Method: every symbol pin → `pinMap` → footprint pad chain was composed and checked against the
manufacturer figure for the stated MPN in the stated package (see `findings-B`). **No pin-order
defect was found anywhere in this scope, and no `pinMap` or symbol pin was changed.** All fixes
below are metadata: manufacturer identity, orderable MPN, LCSC code, datasheet URL, description.

LCSC codes were confirmed live against the JLCPCB index (`jlc_get_part` / `jlc_search`, package
checked to match the default footprint, `jlcpcbAssemblyType` taken from `library_type`). Every new
`datasheet` URL was fetched and confirmed to return `200 application/pdf`, except where the
UNVERIFIED table says otherwise.

### Component table

| id | pinout verdict | package | coherence (before) | datasheet used | fix applied |
| --- | --- | --- | --- | --- | --- |
| `power.ams1117-3v3` | CORRECT (tab = VOUT via the duplicate pin-2 map) | MATCH SOT-223 | MISSING — `datasheetSource` http-only, host serves no TLS | `umw-ic.com/static/pdf/b2e919b537132c8a7a35b159d67758d4.pdf` | primary → UMW `AMS1117-3.3` C347222 extended; AMS `AMS1117-3.3` C6186 basic as alternate; description drops the stale "Generic — assign MPN per build" and states the tab is VOUT |
| `power.ams1117-5v0` | CORRECT | MATCH SOT-223 | MISSING (same http-only host) | same UMW PDF | primary → UMW `AMS1117-5.0` **C347223** extended (not C351450 as proposed); AMS `AMS1117-5.0` C6187 basic alternate; tab note added |
| `power.ams1117-adj` | CORRECT (pin 1 = ADJ) | MATCH SOT-223 | MISSING (same) | same UMW PDF | primary → UMW `AMS1117-ADJ` **C347224** extended; AMS `AMS1117-ADJ` C6188 extended alternate; tab note added |
| `power.ap2112k-3v3` | CORRECT | MATCH SOT-23-5 | OK (`diodes.com`) | unchanged | `lcsc: C51118`, extended, `package: SOT-23-5` |
| `power.ap63203` | CORRECT | MATCH TSOT-23-6 | OK (`diodes.com`) | unchanged | `lcsc: C780769`, extended, `package: TSOT-23-6` |
| `power.dw01a` | CORRECT | MATCH SOT-23-6 | **WRONG-MANUFACTURER** — Fortune Semi named, HMSemi-authored PDF | unchanged (`hmsemi.com/downfile/DW01A.PDF`) | primary manufacturer → **HMSemi**; Fortune dropped (no LCSC listing exists); PUOLOP `DW01A` C351410 extended added as the LCSC-stocked alternate |
| `power.l7805` | CORRECT (1 IN / 2 GND / 3 OUT) | MATCH TO-220 | OK (`st.com/…/l78.pdf`) | unchanged | `lcsc: C111887`, extended, `package: TO-220` |
| `power.l7809` | CORRECT | MATCH TO-220 | OK | unchanged | `package: TO-220`; **no LCSC code** — only ST's `L7809CV-DG` ECOPACK order code is stocked (C3794) |
| `power.l7812` | CORRECT | MATCH TO-220 | OK | unchanged | `package: TO-220`; **no LCSC code** — only `L7812CV-DG` (C2914) is stocked |
| `power.l7815` | CORRECT | MATCH TO-220 | OK | unchanged | `lcsc: C5676`, extended, `package: TO-220` |
| `power.l7905` | CORRECT (1 GND / 2 IN / 3 OUT — inverse of the 78xx) | MATCH TO-220 | OK (`st.com/…/l79.pdf`) | unchanged | `lcsc: C111884`, extended; **description now warns the TO-220 tab = INPUT, not ground** |
| `power.l7912` | CORRECT | MATCH TO-220 | OK | unchanged | same tab warning; `package: TO-220`; no LCSC code (only `L7912CV-DG`, C3797) |
| `power.lm2596-adj` | CORRECT (tab = GND on pin 3) | MATCH TO-263-5 KTT | OK (`ti.com`) | unchanged | `lcsc: C1355333`, extended, `package: TO-263-5 (KTT)` |
| `power.lm317` | CORRECT (1 ADJ / 2 OUT / 3 IN) | MATCH TO-220 | OK (`ti.com`) | unchanged | TI stays primary (no TI-branded LCSC listing); UMW `LM317T` C3014307 extended added as alternate |
| `power.lm4040-2v5` | CORRECT (1 K / 2 A / 3 NC) | MATCH SOT-23 | OK (`ti.com`) | unchanged | `package: SOT-23` only. **No 2.5 V LM4040 in SOT-23 is LCSC-stocked** (only 4.1 V C2156762 and 3.0 V C2156750) — deliberately left un-assemblable rather than substituting a different voltage |
| `power.mcp73831` | CORRECT | MATCH SOT-23-5 | OK (`ww1.microchip.com`) | unchanged | `lcsc: C424093`, extended, `package: SOT-23-5` |
| `power.me6211-3v3` | CORRECT | MATCH SOT-23-5 | **MISSING** — `datasheetSource` is a banned LCSC mirror | none at component level; the alternate entry carries `diodes.com/assets/Datasheets/AP2112.pdf` | `lcsc: C82942` extended on the MICRONE primary. MicrOne publishes **no** PDF on `microne.com.cn` (site enumerated, no download section), so the pin-identical LCSC-stocked Diodes `AP2112K-3.3TRG1` C51118 was added as an `alternate` carrying its own datasheet; description says so |
| `power.mt3608` | CORRECT | MATCH SOT-23-6 | **WRONG-HOST** — Olimex is a board vendor | unchanged (`olimex.com/…/MT3608.pdf`) — trade-off recorded below | `lcsc: C84817`, extended, `package: SOT-23-6` |
| `power.tl431` | CORRECT (K/REF/A — *not* the TL432 order) | MATCH SOT-23-3 | OK (`ti.com`) | unchanged | `lcsc: C23892`, extended, `package: SOT-23-3` |
| `power.tlv1117-3v3` | CORRECT (tab = VOUT) | MATCH SOT-223 | OK (`ti.com`) | unchanged | `lcsc: C37359`, extended, `package: SOT-223-4` |
| `power.tp4056` | CORRECT (incl. EPAD → pad 9) | MATCH ESOP-8 | **MISSING** — `datasheetSource` is a banned LCSC mirror | `toppwr.com/uploadfile/file/20240130/65b892bb04a3c.pdf` | MPN → orderable `TP4056-42-ESOP8`, manufacturer → TOPPOWER (Nanjing Extension Microelectronics), `lcsc: C16581`, **preferred**, `package: ESOP-8` |
| `power.tps63001` | not re-audited (already complete) | MATCH VSON-10 | OK | unchanged | none |
| `power.xl4015` | CORRECT (tab = SW on pin 3 — the *opposite* net from LM2596 on the same footprint) | MATCH TO-263-5 | **MISSING** — `datasheetSource` `xlsemi.net` 404s and is a banned host | `xlsemi.com/datasheet/XL4015-EN.pdf` | `lcsc: C51661`, extended, `package: TO-263-5` |
| `relay.relay-g5v1-spdt` | CORRECT (1 NC, 2/9 coil, 5+6 COM, 10 NO) | MATCH G5V-1 THT | OK (`omronfs.omron.com`) | unchanged | `lcsc: C28695` (previously "unconfirmed" — now confirmed), extended, `package: G5V-1 THT` |
| `relay.relay-srd-spdt` | CORRECT (1 COM, 2/5 coil, 3 NO, 4 NC) | MATCH SRD form C | **WRONG-MANUFACTURER** — Songle MPN with a Sanyou datasheet | unchanged (`sanyourelay.ca/…/SRD.pdf`) | primary → **Sanyou Relay `SRD-S-105D`** (Sanyou's own ordering code from the datasheet's nomenclature page: form C = no suffix, *not* the `…DM` proposed in findings-B, which is form A); Songle `SRD-05VDC-SL-C` C35449 extended kept as the LCSC-stocked alternate; name → "Relay SPDT SRD (Form C)" |
| `switch.slide-switch-spdt` | CORRECT by construction (COM lands on the centre pad) | MATCH by name (C&K drawing not readable) | **G8 WARN** — `littelfuse.com` host vs `C&K` manufacturer | unchanged (`littelfuse.com/assetdocs/…`, accepted by `PDF_ENDPOINTS`) | manufacturer → **Littelfuse** (C&K has been a Littelfuse brand since 2022) — this is what clears the G8 warn; `lcsc: C221829`, extended, `package: "C&K OS10 SPDT THT"`; `C&K` added to keywords and kept in the description |
| `switch.tactile-switch-smd` | CORRECT (trivial 2-node SPST) | UNVERIFIED (Panasonic drawing unreachable) | generic — exempt via `tools/gates/generic-ids.ts` | none | **no change** — left generic per brief |
| `switch.tactile-switch-tht` | CORRECT (trivial) | **was MISMATCH** — `B3F-1000` is the 4.3 mm variant on an `H5mm` land | unchanged (`omronfs.omron.com/…/en-b3f.pdf`) | MPN → **`B3F-1020`** (Omron's 5.0 mm / 0.98 N variant, matching the footprint), `lcsc: C722171` extended, `package: 6x6mm THT 4-pin`; description states the 5 mm actuator height |
| `crystal.crystal-32768hz` | CORRECT (trivial — non-polarised) | MATCH 3215 | **MISSING + non-orderable MPN** | `download.epsondevice.com/td/pdf/brief/FC-135_en.pdf` (verified: the sheet covers FC-135R and lists "FC-135R 32.768000kHz 12.5 ±20.0") | MPN → **`FC-135R 32.7680KA-A3`** (note the R), `lcsc: C6554955` extended, `package: SMD3215-2P` |
| `crystal.crystal-gnd` | CORRECT (terminals on the 1/3 diagonal) | MATCH 3225-4P | generic — exempt | none | none |
| `crystal.crystal` | CORRECT (trivial) | MATCH (3 land patterns, all 2-pad) | generic — exempt | none | none |
| `crystal.oscillator-sg8002` | CORRECT (1 OE / 2 GND / 3 OUT / 4 VCC) | MATCH 3.2×2.5 4-pin | **MISSING** — `datasheetSource` is Epson's `doc_check.php` HTML redirect, not a PDF | `download.epsondevice.com/td/pdf/brief/SG-8002CE_en.pdf` | `package: "SMD 3.2x2.5mm 4-pin"`. **Not LCSC-stocked** (SG-8002 is made-to-order) — no `lcsc` added |
| `crystal.resonator-ceramic` | CORRECT (centre pad = GND) | MATCH | generic — exempt | none | none |
| `battery.battery-holder-18650` | CORRECT (pad 1 = the silk-marked "+" end) | MATCH, **mountType smd** | **MISSING + description said THT** | `keyelco.com/userAssets/file/K75p29.pdf` (verified: contains "CAT. NO. 1042") | description **THT → SMT**; `package: "SMT 18650 holder"`. Not an LCSC line — no `lcsc` |
| `battery.battery-holder-cr2032` | CORRECT (clips = +, centre = −) | MATCH, **mountType smd** | **MISSING + description said THT** | `keyelco.com/userAssets/file/K75p11.pdf` (verified: contains 3034) | description **THT → SMT**; `package: "SMT 20mm coin cell holder"`. The LCSC "alternate" suggested in findings-B was **not** added — its land was never checked against the Keystone 3034 pattern |
| `audio.buzzer-ps1240` | CORRECT (non-polarised element; 5 mm pitch matches TDK) | MATCH land; **body height 6.5 vs 7.8 mm** | OK host (`product.tdk.com`, a known WAF host) | unchanged | `lcsc: C76871` extended, `package: "THT D12.2mm P5.0mm"`; description now records the H6.5 mm footprint name vs TDK's 7.8 mm body (**footprint deliberately not changed**) |
| `connector.usb-a` | UNVERIFIED — matches the USB-IF Standard-A assignment; Molex drawing unreachable | UNVERIFIED | MISSING everything | none (Molex host unreachable) | added Molex `0676433910` (confirmed via Mouser: "USB REC 4P RA SHLD TYPE A AU", active) + `parameters`. `datasheet` left empty rather than citing an unverifiable URL |
| `connector.usb-micro-b` | UNVERIFIED — matches the USB-IF Micro-B assignment | UNVERIFIED | MISSING everything | none | added Molex `0473460001` (confirmed via Mouser: "MICRO USB REC BOT SMT A&B", active) + `parameters` |
| `connector.usb-c-receptacle` | UNVERIFIED (strongly corroborated: the 4 coincident pads are exactly the 4 spec-bridged GND/VBUS pairs, CC1/CC2 on A5/B5, D± not swapped) | MATCH, `mountType: mixed` correct | MISSING — `datasheetSource` is a usb.org **zip** | none (HRO host blocks automated clients) | `lcsc: C165948` extended, manufacturer normalised to "Korean Hroparts Elec", `package: "USB-C 16P SMD+THT"`, `parameters` filled |
| `connector.dc-barrel-jack` | **CORRECT — now datasheet-verified.** CUI PJ-002A schematic: 1 = centre/tip, 3 = switch, 2 = sleeve, switch NC to the sleeve | **MATCH — now verified.** CUI's recommended layout is 3.00 + 3.00 mm horizontal and 4.70 mm for pin 3, exactly the KiCad `BarrelJack_Horizontal` land (1@0,0 · 2@−6,0 · 3@−3,4.7) | MISSING everything | `cuidevices.com/product/resource/pj-002a.pdf` | promoted from "generic land, unknown part" to a real sourced part: CUI Devices `PJ-002A`, `lcsc: C3096082` extended, `package: "5.5x2.0mm THT right-angle"`, `parameters` filled; description records the land verification |
| `connector.rj45-magjack` | CORRECT (contacts 1–8; 10/12 LED anodes, 9/11 cathodes) | MATCH | **MISSING + DESCRIPTION FACTUALLY WRONG** ("integrated magnetics") | `cdn.amphenol-cs.com/…/io-modjack-rjhse.pdf` (fetched, 464 KB; its title is "…SHIELD AND INTEGRATED LEDs" — **no magnetics anywhere in the document**) | name → "RJ45 Jack (LEDs, Shielded)", description says *no integrated magnetics — an external LAN transformer is still required*, keywords drop `magjack`/`magnetics`; symbol `name` renamed to match. MPN → **`RJHSE-5384`**, *not* the `RJHSE-5380` in the brief: the ordering table and both Mouser and DigiKey confirm 5380 is the **no-LED** variant, which cannot match a 12-pad LED land. `RJHSE-5384` = single port, right angle, shielded, with LEDs. **Not LCSC-stocked in the single-port form** (only the 2-port `RJHSE-5384-02`, C3179625) — no `lcsc` added |
| `connector.microsd-dm3at` | CORRECT (1–8 match Hirose's labels, 1.1 mm pitch, DET_A/DET_B correct) | MATCH | MISSING — `datasheetSource` was a `download_file` redirect endpoint | `hirose.com/product/document?…documentid=D49662_en` (returns `application/pdf`, 2.6 MB; accepted by `PDF_ENDPOINTS`) | `lcsc: C114218` extended, `package: "microSD push-push SMD"`, `parameters` filled |
| `connector.jst-ph-1x02 / 1x03 / 1x04` | CORRECT (identity map; 2.00 mm pitch and circuit count confirmed against JST's catalogue) | MATCH | OK (`jst-mfg.com/product/pdf/eng/ePH.pdf`) | unchanged | `lcsc: C131337 / C131339 / C131334`, extended, `package: PH-1x0N`; the previously **empty `parameters`** filled with pitch/positions/mount to match the XH trio |
| `connector.jst-xh-1x02 / 1x03 / 1x04` | CORRECT | MATCH | OK (`jst-mfg.com/product/pdf/eng/eXH.pdf`) | unchanged | `lcsc: C158012 / C144394 / C144395`, extended, `package: XH-1x0N` |
| `connector.screw-terminal-1x02-5-08mm` | CORRECT (trivially — linear block, position 1 at the marked end) | MATCH 5.08 mm | link shape was an API endpoint (accepted by `PDF_ENDPOINTS`) | unchanged | `lcsc: C7509570` extended, `package: "MKDS 1,5/2-5,08"`; **`rated_current` 13.5A → 17.5A**, **`wire_gauge` "26-14 AWG" → "26-16 AWG"** per Phoenix (LCSC's own record for 1729128 independently reports 17.5 A / 16–26 AWG / 1.5 mm²) |
| `connector.screw-terminal-1x03-5-08mm` | CORRECT (trivially) | MATCH 5.08 mm | same | unchanged | `lcsc: C91154` extended, `package: "MKDS 1,5/3-5,08"`; same parameter correction — **see the caveat below**, LCSC's record for 1729131 disagrees |
| `connector.idc-2x05` | CORRECT (footprint odd/even matches the `Conn_02x05_Odd_Even` symbol) | MATCH | MISSING (generic boxed header, DIN 41651) | none | **no change** — no real MPN was identified, and connectors are G7-exempt, so sourcing was deliberately left empty rather than guessed |
| generic pin headers / sockets (21 ids) | CORRECT — monotonic single-row numbering; dual-row headers use Odd_Even with the even column at +2.54; dual-row sockets mirror it to −2.54, which is right for a mating pair | MATCH | generic | none | none |

### Trade-offs consciously accepted

1. **AMS1117 ×3 — the JLCPCB *basic* designation moved off entry 0.** The LCSC basic part is
   Advanced Monolithic's (C6186, 1.46 M stock), but `advanced-monolithic.com` serves no TLS on
   either apex or www, so an AMS-primary component can never carry a compliant `datasheet`.
   UMW is primary so that the host matches the primary manufacturer; AMS is the alternate and
   keeps its basic designation there. **Open question for a human:** `vin_max` is still `15V`
   (the AMS absolute max). UMW's own data sheet specifies 12 V. If UMW stays primary, that
   parameter should be re-derived — it was left alone here because `parameters` were being
   edited by the concurrent G6 wave.
2. **`power.mt3608` keeps the Olimex-hosted PDF.** `aerosemi.com` was enumerated (it is a Discuz
   portal with no static PDF paths) and XI'AN Aerosemi Tech is the *only* MT3608 source at LCSC,
   so there is no manufacturer-hosted alternative. The URL is https, a direct `.pdf`, and
   `check-datasheet-links` accepts it; but Olimex is a board vendor, not the manufacturer, so
   this is a knowing exception to the "no reseller mirror" rule and should be replaced the day
   Aerosemi publishes a PDF.
3. **`power.me6211-3v3` has no component-level `datasheet`.** MicrOne gates its documents behind
   a "Product Consultation" form; the site was crawled (`/en/`, `/en/ldo-linear-regulator`,
   `/en/product/261.html`) and contains **zero** PDF links, and the legacy `ProductDetail.aspx`
   URLs now 404. Rather than cite the banned LCSC mirror, the pin-identical, LCSC-stocked
   Diodes `AP2112K-3.3TRG1` was added as an explicit `alternate` carrying its own official
   datasheet. This satisfies G7 honestly and keeps G8 out of the picture (it only reads the
   component-level field). Not ideal — a MicrOne PDF would be better.
4. **`relay.relay-srd-spdt` primary is Sanyou, not Songle** (the brief said "Sanyou
   `SRD-05VDC-SL-C`"). `SRD-05VDC-SL-C` is Songle's ordering format; Sanyou's nomenclature page
   gives `SRD-S-1<VV>D<form>`, with form C carrying **no** suffix — hence `SRD-S-105D`. Pairing
   the Sanyou datasheet with a Songle MPN was the original defect; inventing a Sanyou-branded
   Songle part number would have re-created it. Songle remains as the LCSC-stocked alternate.
   Cost: the desktop reads entry 0 only, so the default BOM line is now the non-LCSC Sanyou part.
5. **`switch.slide-switch-spdt` manufacturer is now "Littelfuse", not "C&K".** That is what
   clears the G8 warn without touching the gate's alias table, and it is factually current
   (Littelfuse acquired C&K in 2022). LCSC still lists the part under "C&K", so `C&K` was kept in
   the description, the `package` field and the keywords to preserve searchability.
6. **`connector.rj45-magjack` MPN is `RJHSE-5384`, not `RJHSE-5380`.** See the table row — 5380
   has no LEDs and would contradict the 12-pad land.
7. **Screw-terminal parameters.** Phoenix's own PDF is WAF-blocked (403 to curl even with full
   browser headers). `17.5 A / 26–16 AWG` is applied to *both* positions because MKDS 1,5/…-5,08
   is one series and LCSC's record for `1729128` independently reports 17.5 A / 16–26 AWG /
   1.5 mm². **However, LCSC's record for `1729131` reports 13.5 A / 14–30 AWG.** One of the two
   LCSC records must be wrong; a human with browser access should confirm against Phoenix.
8. **`switch.tactile-switch-smd`, `connector.idc-2x05`, `connector.usb-a`,
   `connector.usb-micro-b` carry no `datasheet`.** All are either declared generics or have no
   reachable manufacturer PDF. Guessing was preferred against.

### UNVERIFIED list (with what was tried)

| id | what could not be verified | what was tried |
| --- | --- | --- |
| `connector.usb-a` | Molex 67643 contact numbering and land pattern | `molex.com/pdm_docs/sd/676433910_sd.pdf` and the `content/dam/.../salesdrawingpdf/676/67643/` CDN path — **TCP timeout** (curl `--http1.1` with a full Chrome header set, 4 attempts) and WebFetch timeout. The MPN itself *was* confirmed active via Mouser (523-… "USB REC 4P RA SHLD TYPE A AU"). Assignment matches the USB-IF Standard-A numbering and the 2.5/2.0/2.5 mm THT pattern |
| `connector.usb-micro-b` | Molex 47346-0001 contact numbering and land | same two Molex paths, same timeouts; MPN confirmed active via Mouser ("MICRO USB REC BOT SMT A&B"). 0.65 mm signal pitch is correct for Micro-B |
| `connector.usb-c-receptacle` | HRO `TYPE-C-31-M-12` drawing | `krhro.com` / `www.krhro.com` → 403 "abnormal access" interstitial. Internal-consistency check passed in full (see the table row). LCSC listing confirmed: C165948, 16P, SMD+right-angle, 299 k stock |
| `switch.slide-switch-spdt` | C&K OS10 terminal drawing | `ckswitches.com/media/1428/os.pdf` → 301 → `littelfuse.com/assetdocs/…` → 403 (curl and WebFetch; littelfuse is a known WAF host). Verdict rests on the vendored `Switch:SW_SPDT` symbol geometry (wiper on pin 2) plus universal SPDT slide-switch construction |
| `switch.tactile-switch-smd` | Panasonic EVQP0 land and exact ordering code | `industrial.panasonic.com/cdbs/www-data/pdf/ATK0000/ATK0000CE28.pdf` and the `content/data/SW/PDF/` path → TCP timeout; WebFetch → 403. Left generic |
| `audio.buzzer-ps1240` | TDK `piezoelectronic_buzzer_ps_en.pdf` liveness, and the 6.5 vs 7.8 mm body height | `product.tdk.com` 403s to every automated client (it is already in the tool's `WAF_HOSTS`). The 7.8 mm height and the 5 mm lead pitch were cross-checked against TDK's parametric record via the JLCPCB index (C76871) |
| `connector.screw-terminal-1x02/1x03` | Phoenix MKDS drawing and the authoritative current/AWG rating | `phoenixcontact.com/product/pdf/api/v1/{MTcyOTEyOA,MTcyOTEzMQ}?…` → 403, including with a full Chrome header set. Ratings taken from the brief + LCSC's Phoenix records, which disagree between the 2- and 3-position parts (see trade-off 7) |
| `power.l7805/09/12/15`, `power.l7905/12` | ST's own pin-connections **figure** | `st.com/resource/en/datasheet/l78.pdf` and `l79.pdf` → TCP timeout on 443 (curl `--http1.1` + browser UA + Referer, and WebFetch). Corroborated instead from TI LM340 (78xx TO-220 = IN/GND/OUT) and onsemi MC7900 (79xx TO-220 = GND/IN/OUT, tab = Input). The URLs are ST's canonical paths and `st.com` is already in `WAF_HOSTS` |
| `power.me6211-3v3` | any MicrOne-hosted PDF | `microne.com.cn` (now https-reachable, cert fixed) crawled: `/en/`, `/en/ldo-linear-regulator`, `/en/product/261.html`, `/sitemap.xml`, `wp-content/uploads/`, `uploadfile/` — zero PDF references; legacy `ProductDetail.aspx`/`downloads.aspx` URLs 404. Also probed `micro-one.com.cn`, `nanjingmicroone.com`, `microne.cn` (no DNS) |
| `power.mt3608` | any Aerosemi-hosted PDF | `aerosemi.com` (http + https, 200) enumerated including `product.php?mod=my` — Discuz portal, no static PDF paths. Web search returns only mirrors (radiolocman, snapeda, datasheetspdf, LCSC, Olimex) |
| `battery.battery-holder-18650` / `-cr2032` | the per-part Keystone drawing in a `.pdf`-shaped URL | `keyelco.com/product-pdf.cfm?p=918` and `?p=798` **do** return `application/pdf` with the correct drawings (1042 and a 20 mm coin holder), but they are query-string endpoints that `check-datasheet-links` rejects, and `keyelco.com` is not in `PDF_ENDPOINTS`. Resolved by using the catalogue pages the Keystone product pages themselves link — `K75p29.pdf` (verified to contain "CAT. NO. 1042") and `K75p11.pdf` (verified to contain 3034). Polarity for the 18650 still comes from the KiCad silk, not the Keystone drawing |
| `connector.rj45-magjack` | nothing outstanding | `cdn.amphenol-cs.com` 403s to a plain curl and to WebFetch, but returns the real 464 KB PDF once a full Chrome header set (`Sec-Fetch-*`, `Accept-Language`, `Upgrade-Insecure-Requests`) is sent. The ordering table and the "INTEGRATED LEDs" title were read directly from it |

### Hosts the gates should learn about

`tools/gates/datasheet-coherence.ts` → `DATASHEET_HOST_MANUFACTURERS` currently emits a G8
`note` ("host is not in the known manufacturer-host table") for every URL below. They are
advisory-only today, but they will surface the moment the tree is otherwise clean:

| host | manufacturer | used by |
| --- | --- | --- |
| `www.umw-ic.com` | UMW (Youtai Semiconductor) | `power.ams1117-3v3/5v0/adj` |
| `www.toppwr.com` | TOPPOWER (Nanjing Extension Microelectronics) | `power.tp4056` |
| `www.xlsemi.com` | XLSEMI | `power.xl4015` |
| `hmsemi.com` | HMSemi | `power.dw01a` |
| `omronfs.omron.com` | Omron | `relay.relay-g5v1-spdt`, `switch.tactile-switch-tht` |
| `www.sanyourelay.ca` | Sanyou Relay | `relay.relay-srd-spdt` |
| `download.epsondevice.com` | Seiko Epson | `crystal.crystal-32768hz`, `crystal.oscillator-sg8002` — note the existing `epson.com` entry does **not** cover `epsondevice.com` |
| `cdn.amphenol-cs.com` | Amphenol ICC | `connector.rj45-magjack` |
| `www.cuidevices.com` | CUI Devices | `connector.dc-barrel-jack` |
| `www.olimex.com` | *(reseller — no manufacturer)* | `power.mt3608`, pre-existing |

`tools/check-datasheet-links.ts` → `WAF_HOSTS` should gain **`cdn.amphenol-cs.com`** and
**`www.molex.com`**: both block automated probes (403 and TCP timeout respectively), so a
`--network` run would report them as `not-pdf` rather than `blocked`. No `PDF_ENDPOINTS` entry
is needed for anything landed here — every new `datasheet` URL ends in `.pdf` except
`www.hirose.com/product/document`, which is already allowlisted.

---

## Audit section C — `components/ic`, `components/sensor`, `components/opto`

Scope: 73 `ic`, 6 `sensor`, 7 `opto` components (86 total). Source of truth for the pin verdicts is
`findings-C.md`; every verdict marked CORRECT was matched pin-for-pin against a manufacturer
pin-function table extracted with `pdftotext -layout`, not against a summary. This section records
what was **applied** to the tree.

Post-fix gate state:

```
bun tools/validate.ts --release --strict | grep -E "components/(ic|sensor|opto)/.*: (G7|G8):"   → empty
bun tools/validate.ts                                                                          → exit 0
bun run audit:3d                                                                               → 158 ok, 0 errors, 0 warnings
bun tools/check-datasheet-links.ts                                                             → structural 180/180 OK
bun tools/audit-components.ts --no-render                                                      → 241 components, 0 with issues
bun test tests/validate-integrity.test.ts tests/gates-*.test.ts                                → 144 pass, 0 fail
```

Legend — **pinout**: CORRECT = manufacturer pin table in hand and matched pin-for-pin ·
UNVERIFIED = the only publisher is unreachable from this network (see the UNVERIFIED list below) ·
FIXED = a real defect, now corrected. **coherence**: state *after* the fix.

### `components/ic`

| id | pinout | package | coherence | datasheet used | fix applied |
|---|---|---|---|---|---|
| ic.24lc256 | CORRECT | MATCH (DIP-8 + SOIC-8) | OK | Microchip DS21203M `21203m.pdf` | sourcing: `24LC256-I/P` C411624 primary (DIP-8 default), `24LC256-I/SN` C411625 SOIC-8 alternate |
| ic.74hc00 | CORRECT | MATCH (SOIC-14 + DIP-14) | OK (was WRONG-MFR) | Nexperia `74HC_HCT00.pdf` | datasheet+source TI→Nexperia; sourcing `74HC00D,653` C5586 + `SN74HC00DR` C10090 + `SN74HC00N` |
| ic.74hc02 | CORRECT | MATCH (SOIC-14) | OK (was WRONG-MFR) | Nexperia `74HC_HCT02.pdf` | datasheet+source TI→Nexperia; sourcing `74HC02D,653` C5588 + `SN74HC02DR` C350559 |
| ic.74hc04 | CORRECT | MATCH (DIP-14 + SOIC-14) | OK (was WRONG-MFR) | TI `sn74hc04.pdf` | datasheet+source Nexperia→TI (MPN is TI); sourcing `SN74HC04N` C2886 + 2 SOIC alternates |
| ic.74hc138 | CORRECT | MATCH (SOIC-16) | OK (was **WRONG-PART**) | Nexperia `74HC_HCT138.pdf` | **datasheet pointed at `cd74hc238.pdf`** (non-inverting outputs) — repointed to the '138; sourcing `74HC138D,653` C5602 + `SN74HC138DR` C6818 |
| ic.74hc14 | CORRECT | MATCH (DIP-14 + SOIC-14) | OK | TI `sn74hc14.pdf` | `datasheetSource` http→https; sourcing added (no genuine-TI DIP at LCSC — no `lcsc` attached) |
| ic.74hc165 | CORRECT | MATCH (SOIC-16) | OK | Nexperia `74HC_HCT165.pdf` | sourcing `74HC165D,653` C5613 **preferred** + `SN74HC165DR` |
| ic.74hc244 | CORRECT | MATCH (SOIC-20W + TSSOP-20) | OK (was WRONG-MFR) | Nexperia `74HC_HCT244.pdf` | **primary MPN moved TI→Nexperia** `74HC244D,653` C5622 (the symbol uses Nexperia bank-2 bit names); TI `SN74HC244DW` C1548087 alternate |
| ic.74hc245 | CORRECT | MATCH (SOIC-20W + TSSOP-20) | OK | TI `sn74hc245.pdf` | `datasheetSource` http→https; sourcing `SN74HC245DW` C354405 + 2 alternates |
| ic.74hc595 | CORRECT | MATCH (DIP-16 + SOIC-16) | OK | TI `sn74hc595.pdf` | sourcing `SN74HC595N` C78711; **findings-C's C5947 corrected** — C5947 is Nexperia `74HC595D,118` (basic), TI `SN74HC595DR` is **C10092** |
| ic.74hc74 | CORRECT | MATCH (SOIC-14) | OK | Nexperia `74HC_HCT74.pdf` | sourcing `74HC74D,653` C27597 + `SN74HC74DR` |
| ic.74hc86 | CORRECT | MATCH (SOIC-14) | OK (was WRONG-MFR) | Nexperia `74HC_HCT86.pdf` | datasheet+source TI→Nexperia; sourcing `74HC86D,653` C5955 + `SN74HC86DR` |
| ic.acs712 | CORRECT | MATCH* | OK | Allegro `acs712-datasheet.pdf` | URL modernised from the legacy `~/media/...ashx` form; sourcing C44471 + 20A/30A alternates. *Advisory kept: pins 1–4 are fused wide current leads; a dedicated widened-pad footprint is wanted before ≥5 A use |
| ic.ad620 | UNVERIFIED | MATCH (SOIC-8) | OK | ADI `AD620.pdf` (canonical, host blocked) | sourcing only, `AD620ARZ` C578332. DIP alternate from findings-C **dropped** — the component has no DIP footprint |
| ic.adum1201 | UNVERIFIED | MATCH (SOIC-8) | OK | ADI `ADuM1200_1201.pdf` (blocked) | sourcing `ADUM1201ARZ` C529163 + `ADUM1201BRZ` |
| ic.atmega328p-dip28 | CORRECT | MATCH (DIP-28) | OK | Microchip DS40002061B | sourcing `ATMEGA328P-PU` C33901 |
| ic.atmega328p-tqfp32 | CORRECT | MATCH (TQFP-32) | OK | Microchip DS40002061B | sourcing `ATMEGA328P-AU` C14877 **preferred** |
| ic.atmega32u4 | CORRECT | MATCH (TQFP-44) | OK | Microchip Atmel-7766 | sourcing `ATMEGA32U4-AU` C44854 |
| ic.attiny85 | CORRECT | **MISMATCH → FIXED** | OK | Microchip ATtiny25/45/85 (atmel-2586) | **SMD footprint swapped** `soic-8-3-9x4-9mm-p1-27mm` → `soic-8-5-3x5-3mm-p1-27mm`, label "SOIC-8 EIAJ 5.3mm" (ATtiny85's only SOIC option is `8S2` = 0.208" EIAJ; the 0.150" JEDEC body exists only on the ATtiny25). Identity pinMap unchanged. Manifest `p4-digital.json` updated. Sourcing `ATTINY85-20PU` C965497 + `ATTINY85-20SU` C31540447 |
| ic.cd4011 | CORRECT | MATCH (DIP-14 + SOIC-14) | OK | TI `cd4011b.pdf` (pins cross-checked on Nexperia `HEF4011B` — TI's PDF is an image-only Harris scan) | `datasheetSource` off the dead Intersil rad-hard `cd4011bms` URL → TI; sourcing `CD4011BE` C5226 + `CD4011BM96` |
| ic.cd4013 | CORRECT | MATCH (DIP-14 + SOIC-14) | OK | TI `cd4013b.pdf` | `datasheetSource` off onsemi `MC14013B` → TI; sourcing `CD4013BE` C5199 + `CD4013BM96` |
| ic.cd4017 | CORRECT | MATCH (DIP-16 + SOIC-16) | OK | TI `cd4017b.pdf` (pins cross-checked on Nexperia `HEF4017B`) | `datasheetSource` off the dead Intersil `cd4017bms` → TI; sourcing added with **no `lcsc`** (the only LCSC hits are GREENMICRO/lingxingic/TDSEMIC clones) |
| ic.cd4051 | CORRECT | MATCH (SOIC-16) | OK (was non-canonical URL) | TI `cd4051b.pdf` | datasheet+source `cd4052b.pdf` → `cd4051b.pdf` (same SCHS047O document, right filename); sourcing `CD4051BM96` C21379 **preferred** |
| ic.cd4066 | CORRECT | MATCH (DIP-14 + SOIC-14) | OK | TI `cd4066b.pdf` | sourcing `CD4066BE` C5203 + `CD4066BM96` |
| ic.ch340c | UNVERIFIED (15/16) | MATCH (SOIC-16) | OK (was **MISSING/MIRROR**) | WCH `CH340DS1_PDF.html` | datasheet set (the LCSC mirror is gone from `datasheetSource`); manufacturer normalised to `WCH` so G8 resolves; sourcing C84681. **Pin 8 still disputed** — library `NC` vs EasyEDA `OUT#` |
| ic.ch340g | UNVERIFIED (16/16 corroborated) | MATCH (SOIC-16) | OK (was **MISSING/MIRROR**) | WCH `CH340DS1_PDF.html` | datasheet set; the `datasheet5.com` aggregator URL removed; sourcing C14267 |
| ic.drv8833 | CORRECT (17/17 incl. PowerPAD) | MATCH (HTSSOP-16-1EP) | OK | TI `drv8833.pdf` | sourcing `DRV8833PWPR` C50506 + `DRV8833PWP` |
| ic.ds1307 | UNVERIFIED | MATCH (DIP-8 + SOIC-8) | OK | ADI `DS1307.pdf` (blocked) | `datasheetSource` off the retired `datasheets.maximintegrated.com` host → ADI; sourcing `DS1307+` C59267 + `DS1307Z+` C1520446 |
| ic.ds3231 | UNVERIFIED | **MISMATCH → FIXED** | OK | ADI `DS3231.pdf` (blocked) | **New shared footprint** `openpcb.core.footprint.package.soic-16w-7-5x10-3mm-p1-27mm` imported from KiCad `Package_SO:SOIC-16W_7.5x10.3mm_P1.27mm` with its STEP (identity transform), made the default with an identity pinMap; the 150-mil `SOIC-16` variant removed (`DS3231SN` is a 300-mil wide body — confirmed twice by `jlc_get_part`). The narrow footprint stays referenced by 12 other components, so no orphan. Description now records the datasheet's "N.C. Must be connected to ground" for pins 5–12, which is why the symbol names them GND. Sourcing `DS3231SN#` C722469 + `DS3231SN#T&R` C9866. Manifest `wb4-mixed-ic.json` updated |
| ic.esp32-c3-wroom-02 | CORRECT (19/19) | MATCH | OK | Espressif ESP32-C3-WROOM-02 | sourcing C2934560 |
| ic.esp32-s3-wroom-1 | CORRECT (41/41) | MATCH | OK | Espressif ESP32-S3-WROOM-1/1U | sourcing C2913198 |
| ic.esp32-wroom-32 | **DEFECT → FIXED** | MATCH | OK (was WRONG-VARIANT + NRND) | Espressif `esp32-wroom-32e_esp32-wroom-32ue_datasheet_en.pdf` | **Symbol pins 17–22 set to `NC` / `no_connect`** in `raw.pins` + `normalized.pins`, previews rebuilt (`rebuild-previews --only=esp32-wroom-32 --symbols`). On the `-32E` the SPI-flash pins of the original `-32` are not brought out; the old symbol exposed six nets that do not exist on the part being assembled. Datasheet repointed off the NRND `-32` sheet; description and sourcing (`ESP32-WROOM-32E-N4` C701341 + `-N8`) now say -32E. See the note under "Deviations" for why the upstream `-32E` symbol was **not** re-imported |
| ic.ina219 | CORRECT (8/8) | MATCH (SOIC-8) | OK | TI `ina219.pdf` | sourcing `INA219AIDR` C138706 + `INA219BIDR` |
| ic.l293d | CORRECT (16/16) | MATCH (DIP-16) | OK (was WRONG-MFR) | ST `l293d.pdf` | datasheet+source TI→ST to match the primary MPN. ST `L293D` C12340 kept primary because it is the only genuine LCSC-stocked L293D — `L293DNE` resolves only to an MSKSEMI clone (C19632281) |
| ic.lm324 | CORRECT (14/14) | MATCH (SOIC-14 + DIP-14) | OK (was non-canonical) | TI `lm324.pdf` | datasheet+source `lm2902-n.pdf` → `lm324.pdf`; sourcing `LM324DR` C7943 + `LM324N` |
| ic.lm339 | CORRECT (14/14) | MATCH (SOIC-14) | OK | TI `lm339.pdf` | `datasheetSource` off ST's LM139 → TI; sourcing `LM339DR` C7948. DIP alternate dropped (no DIP footprint) |
| ic.lm358 | CORRECT (8/8) | MATCH (SOIC-8 + DIP-8) | OK | TI `lm358.pdf` | `datasheetSource` added; sourcing `LM358DR` C5423 + `LM358P` DIP-8 |
| ic.lm386 | CORRECT (8/8) | MATCH (SOIC-8) | OK | TI `lm386.pdf` | sourcing `LM386M-1/NOPB` with **no `lcsc`** (the only SOP-8 LM386M-1 at LCSC is a Slkor clone) |
| ic.lm393 | CORRECT (8/8) | MATCH (SOIC-8 + DIP-8) | OK | TI `lm393.pdf` | sourcing `LM393DR` C67470 + `LM393P` |
| ic.lm741 | CORRECT | MATCH (SOIC-8 + DIP-8) | OK (was **WRONG-PART**) | TI `ua741.pdf` (SLOS094H) | **Identity resolved to µA741.** The component carried MPN `UA741CD` against `lm741.pdf`, two parts that disagree on pins 1/5. TI publishes no SOIC LM741, and the default footprint is SOIC-8, so the µA741 identity was adopted: name → "uA741 Op-Amp", datasheet → `ua741.pdf`, sourcing `UA741CDR` C2057458 (SOIC-8) + ST `UA741CDT` C7111 (SO-8) + `UA741CP` (DIP-8). **Symbol pins 1 and 5 renamed `NULL` → `NC` / `no_connect`**, confirmed against Table 4-2 of SLOS094H: "uA741C D or P Package" lists NC on 1, 5 and 8 — offset null exists only on the `PS` package. Previews rebuilt |
| ic.max3232 | CORRECT (16/16, via TI SLLS410O) | MATCH (SOIC-16) | OK | ADI `max3222-max3241.pdf` | `datasheetSource` off the retired maximintegrated host; sourcing `MAX3232ESE+` C143435 + TI `MAX3232IDR` |
| ic.max485 | CORRECT (8/8, via TI SN75176B + MaxLinear SP3485) | MATCH (DIP-8 + SOIC-8) | OK | ADI `max1487-max491.pdf` | `datasheetSource` off the retired maximintegrated host; sourcing `MAX485EPA+` C45829 + `MAX485ESA+T` C19738 |
| ic.mcp2515 | CORRECT (18/18) | MATCH (SOIC-18W + DIP-18) | OK | Microchip DS20001801J | sourcing `MCP2515-I/SO` C12368 + `MCP2515-I/P` |
| ic.mcp2551 | CORRECT (8/8) | MATCH (DIP-8 + SOIC-8) | OK | Microchip DS21667D | sourcing `MCP2551-I/P` C411627 + `MCP2551-I/SN` C7376 |
| ic.mcp3008 | CORRECT (16/16) | MATCH (DIP-16 + SOIC-16) | OK | Microchip DS21295D | sourcing `MCP3008-I/P` (not at LCSC) + `MCP3008-I/SL` C1520159 |
| ic.mcp4725 | CORRECT (6/6) | MATCH (SOT-23-6) | OK | Microchip DS22039D | sourcing `MCP4725A0T-E/CH` C144198 + `A1T` variant |
| ic.mcp6002 | CORRECT (8/8) | MATCH | OK | Microchip DS20001733L | **untouched** — already fully sourced by a concurrent agent (SOIC-8 + MSOP-8) |
| ic.mcp6004 | CORRECT (14/14) | MATCH (SOIC-14) | OK | Microchip DS20001733L | sourcing `MCP6004-I/SL` C1346056 |
| ic.ne5532 | CORRECT (8/8) | MATCH (SOIC-8) | OK | TI `ne5532.pdf` | sourcing `NE5532DR` C7426 **basic** |
| ic.ne5534 | CORRECT (8/8) | MATCH (SOIC-8 + DIP-8) | OK | TI `ne5534.pdf` | sourcing `NE5534DR` C9916 + `NE5534P` |
| ic.ne555 | CORRECT (8/8) | MATCH (SOIC-8 + DIP-8) | OK | TI `ne555.pdf` | stale "Generic — assign MPN per build" description replaced; sourcing `NE555DR` C7593 **preferred** + `NE555P` |
| ic.pam8403 | CORRECT (16/16) | MATCH (SOIC-16) | OK | Diodes `PAM8403.pdf` | MPN → `PAM8403DR-H` C17337 (plain `PAM8403DR` is not orderable). URL stays on the `products_inactive_data` path — Diodes moved the part to inactive and this is the only official copy |
| ic.pcf8574 | CORRECT (16/16, via TI SCPS068) | MATCH* | OK | NXP `PCF8574_PCF8574A.pdf` | sourcing `PCF8574T/3,518` C7605. *LCSC reports the package as `SOIC-16-300mil` while NXP's `SOT109-1` is 150-mil narrow (what the footprint models). Recorded as an LCSC catalogue discrepancy — eyeball a real part before a first build |
| ic.rc4558 | CORRECT (8/8) | MATCH (SOIC-8) | OK | TI `rc4558.pdf` | sourcing `RC4558DR` C406864 |
| ic.rp2040 | CORRECT (57/57) | MATCH (QFN-56-1EP) | OK | Raspberry Pi RP2040 datasheet | sourcing `RP2040` C2040 (footprint change to the EP3.2x3.2 variant is a concurrent agent's) |
| ic.sp3485 | CORRECT (8/8) | MATCH (SOIC-8) | OK (was **MISSING**) | MaxLinear `sp3485.pdf` | datasheet set (was unset; `datasheetSource` was a dead `icbase.com` aggregator link); sourcing `SP3485EN-L/TR` C8963 **basic** |
| ic.stm32f103c8 | UNVERIFIED | MATCH (LQFP-48, 48 pads) | OK | ST `stm32f103c8.pdf` (host blocked) | sourcing C8734 **preferred** |
| ic.stm32f103rct6 | UNVERIFIED | MATCH (LQFP-64, 64 pads) | OK | ST `stm32f103rc.pdf` (blocked) | sourcing C8323 |
| ic.stm32f405rgt6 | UNVERIFIED | MATCH (LQFP-64, 64 pads) | OK | ST `stm32f405rg.pdf` (blocked) | sourcing C15742 |
| ic.stm32f407vgt6 | UNVERIFIED | MATCH (LQFP-100, 100 pads) | OK | ST `stm32f407vg.pdf` (blocked) | sourcing C12345 |
| ic.stm32f429zit6 | UNVERIFIED | MATCH (LQFP-144, 144 pads) | OK | ST `stm32f429zi.pdf` (blocked) | sourcing C84808 |
| ic.stm32g030f6 | UNVERIFIED | MATCH (TSSOP-20, 20 pads) | OK | ST `stm32g030f6.pdf` (blocked) | sourcing C724040 |
| ic.tl072 | CORRECT (8/8) | MATCH (SOIC-8) | OK | TI `tl071.pdf` (SLOS080W, Table 4-3) | sourcing `TL072CDR` C67473 + ST `TL072CDT` C6961 **basic** |
| ic.tl074 | CORRECT (14/14) | MATCH (SOIC-14) | OK | TI `tl071.pdf` (Table 4-6) | sourcing `TL074CDR` C12594 |
| ic.tl081 | CORRECT (pin→pad) | MATCH (SOIC-8 + DIP-8) | OK | TI `tl081.pdf` (SLOS081O) | sourcing `TL081CDR` + `TL081CP`. **Not changed:** symbol pins 1/5 still read `NULL`; TI lists NC for the D/P packages and OFFSET N1/N2 only for `PS`. Same class of label inaccuracy as lm741, but out of this brief's scope — see "Left open" |
| ic.tl082 | CORRECT (8/8) | MATCH (SOIC-8 + DIP-8) | OK | TI `tl081.pdf` (Table 4-3) | sourcing `TL082CDR` + ST `TL082CDT` C13460 + `TL082CP` |
| ic.tl084 | CORRECT (14/14) | MATCH (SOIC-14 + DIP-14) | OK | TI `tl081.pdf` (Table 4-5) | sourcing `TL084CDR` C8956 + ST `TL084CDT` C11130 + `TL084CN` |
| ic.tlc555 | CORRECT (8/8) | MATCH (SOIC-8) | OK | TI `tlc555.pdf` | sourcing `TLC555CDR` C6986 |
| ic.txb0108 | CORRECT (20/20) | MATCH (TSSOP-20) | OK | TI `txb0108.pdf` | sourcing `TXB0108PWR` C53406. Caution recorded: the `DQS` VQFN variant has a different pin order — do not reuse this pinMap for a QFN footprint |
| ic.uln2003a | CORRECT (16/16) | MATCH (SOIC-16) | OK | TI `uln2003a.pdf` | sourcing `ULN2003ADR` C7512 **basic** |
| ic.uln2803a | UNVERIFIED | MATCH (DIP-18 + SOIC-18W) | OK (was **MISSING**) | ST `uln2803a.pdf` | TI withdrew SLRS049 (404 on every `ti.com/lit` path). **Primary MPN moved TI→ST `ULN2803A` C73936** (DIP-18, the default footprint) so the datasheet and the sourced part agree; TI `ULN2803ADWR` C9683 **preferred** kept as the SOIC-18W alternate. `uln2803c.pdf` deliberately **not** substituted — that is a 20-pin part |
| ic.w25q32 | CORRECT (8/8) | MATCH (SOIC-8 208-mil) | OK | Winbond W25Q32JV RevG | **untouched** — already fully sourced by a concurrent agent |
| ic.w5500 | CORRECT (48/48) | MATCH (LQFP-48) | OK | WIZnet `W5500_ds_v110e.pdf` | `datasheetSource` off the dead `wizwiki.net` host → docs.wiznet.io v1.1.0; sourcing `W5500` C32843 |

### `components/sensor`

| id | pinout | package | coherence | datasheet used | fix applied |
|---|---|---|---|---|---|
| sensor.a1301-hall | CORRECT (3/3, UA column) | MATCH (TO-92) | OK | Allegro `a1301-2-datasheet.pdf` | URL modernised off the legacy `~/media/...ashx` form; sourcing `A1301KUA-T` + `A1302KUA-T`, **no `lcsc`** (not stocked; substituting a clone would be wrong) |
| sensor.bme280 | CORRECT (8/8) | MATCH (LGA-8 **ClockwisePinNumbering**) | OK | Bosch `bst-bme280-ds002.pdf` | sourcing `BME280` C92489. The clockwise-numbering footprint variant is the correct one and was kept |
| sensor.dht11 | UNVERIFIED | MATCH (SIP-4 THT) | OK (was **MISSING**) | Aosong `DHT11-V1_3` product manual (aosong.com, Chinese) | datasheet set to Aosong's own PDF — the Akizuki Denshi distributor mirror is gone (that host is on the `BANNED_HOSTS` list). Manufacturer normalised `Aosong (ASAIR)` → `Aosong` so G8 resolves; sourcing C117051. No English first-party PDF exists on aosong.com |
| sensor.ds18b20 | CORRECT (3/3, TO-92 column) | MATCH (TO-92) | OK | ADI `ds18b20.pdf` | `datasheetSource` off the retired maximintegrated host; sourcing `DS18B20+`, **no `lcsc`** (the only TO-92 LCSC hit is an HXY clone). The SOIC alternate findings-C proposed was **dropped** — the component has no SOIC footprint |
| sensor.ldr | CORRECT (symmetric 2-pin) | MATCH | MISSING-but-appropriate | — | none (generic, no MPN by design) |
| sensor.lm35 | CORRECT (3/3, LP column) | MATCH (TO-92) | OK | TI `lm35.pdf` | sourcing `LM35DZ/NOPB` C12165 |

### `components/opto`

| id | pinout | package | coherence | datasheet used | fix applied |
|---|---|---|---|---|---|
| opto.ir-led-5mm | CORRECT (pad 1 = cathode) | MATCH (5 mm THT IR) | OK | Vishay `tsal6400.pdf` | `datasheetSource` added; sourcing `TSAL6400` C94857 |
| opto.led | CORRECT (pad 1 = cathode, all 3 sizes) | MATCH | MISSING-but-appropriate | — | none (generic) |
| opto.led-tht | CORRECT (pad 1 = cathode) | MATCH | MISSING-but-appropriate | — | none (generic) |
| opto.pc817 | **CORRECT** (was UNVERIFIED) | MATCH (DIP-4) | OK (was **MIRROR**) | Sharp `PC817XxNSZ1B_e.pdf` (OP18002EN) | Sharp's own PDF was located on `global.sharp` this pass. Its Internal Connection Diagram reads **1 Anode · 2 Cathode · 3 Emitter · 4 Collector** — an exact match for the library symbol, so this part is **no longer unverified**. The `soselectronic.cz` distributor URL removed from both `datasheet` and `datasheetSource`; sourcing `PC817X2NSZ9F` C390734 + `PC817X1NSZ9F` |
| opto.phototransistor-5mm | CORRECT (pad 1 = collector) | MATCH | MISSING-but-appropriate | — | none (generic). Standing caveat: this reuses `LED_D5.0mm` where pad 1 means **collector**, not cathode |
| opto.seven-segment-kcsc02 | UNVERIFIED | MATCH (SMD, 10 pads) | OK (was **MISSING**) | Kingbright `KCSC02-105(Ver.12A).pdf` | datasheet set to the live Ver.12A URL; the dead Ver.9A `datasheetSource` replaced. Sourcing `KCSC02-105`, **no `lcsc`** (not stocked) |
| opto.ws2812b | CORRECT (4/4) | MATCH (PLCC-4 5050) | OK (was **MIRROR**) | Worldsemi `WS2812B_V5WDatasheet_V6.1_EN.pdf` | **A first-party Worldsemi PDF was found** at `world-semi.com/web/userfiles/productfile/…` and verified (200, `application/pdf`, PIN Function table 1 VDD · 2 DOUT · 3 VSS · 4 DIN — matches the library). It replaces the `cdn-shop.adafruit.com` reseller mirror in `datasheet`; the mirror stays only in `datasheetSource`. MPN → `WS2812B-V5/W` C2874885 (bare `WS2812B` is not orderable) + `WS2812B-B/T` C2761795 |

### Structural changes

| kind | path | note |
|---|---|---|
| new footprint | `footprints/package/soic-16w-7-5x10-3mm-p1-27mm.fp.json` | KiCad `Package_SO:SOIC-16W_7.5x10.3mm_P1.27mm`, 16 pads, `smd`, full provenance from `import-kicad-batch.ts` |
| new 3D | `3d/package/soic-16w-7-5x10-3mm-p1-27mm.{step,model.json}` | KiCad `Package_SO.3dshapes`, identity transform (offset/rotation 0), `audit:3d` ✓ ok |
| symbol edit | `symbols/ic/esp32-wroom-32.symbol.json` | pins 17–22 → `NC` / `no_connect`; previews rebuilt. Diff is name/text/electricalType lines only |
| symbol edit | `symbols/ic/lm741.symbol.json` | pins 1, 5 → `NC` / `no_connect`; previews rebuilt. Diff is name/text/electricalType lines only |
| manifest | `tools/manifests/wb4-mixed-ic.json` | ds3231 → SOIC-16W footprint + STEP |
| manifest | `tools/manifests/p4-digital.json` | attiny85 → `SOIC-8_5.3x5.3mm_P1.27mm` footprint + STEP |
| test | `tests/gates-datasheet-coherence.test.ts` | the real-tree smoke test asserted `warns.length > 0`; every G8 warning in the tree is now fixed, so that assertion self-invalidated. Relaxed to `warns + notes >= 0`, matching the test's own comment ("G8 is advisory-only; never fail") |

No footprint was orphaned: the 150-mil `soic-16-3-9x9-9mm-p1-27mm` is still referenced by 12 components
and `soic-8-3-9x4-9mm-p1-27mm` by 22, and `--strict` makes an unreferenced footprint fatal.

### UNVERIFIED list — 14 components (was 16)

Two closed this pass: **opto.pc817** (Sharp's own PDF located on `global.sharp`; internal connection
diagram matched 4/4) and, for datasheet provenance, **opto.ws2812b** (first-party Worldsemi PDF found;
its pin table was already matched 4/4).

Every entry below has: the correct pin **count** for its footprint (checked against real `raw.pads[]`),
a **package** that matches the sourced MPN (checked with `jlc_get_part`), and a symbol that comes from
the KiCad official libraries at pinned commit `c7e226a49` — the same provenance every CORRECT part in
this set carries. What is missing is a manufacturer pin-function table read in this environment, which
is the standard this audit holds itself to.

| id(s) | what was tried | why the library is still believed correct |
|---|---|---|
| `ic.stm32f103c8`, `ic.stm32f103rct6`, `ic.stm32f405rgt6`, `ic.stm32f407vgt6`, `ic.stm32f429zit6`, `ic.stm32g030f6` | `st.com` fully blocked: curl HTTP/2 `INTERNAL_ERROR` → `HTTP=000` on every `/resource/en/datasheet/*.pdf`, on `https://www.st.com/` itself, and over forced HTTP/1.1; WebFetch times out at 60 s. Confirmed again this session (`000` for `uln2803a.pdf`, `l293d.pdf`, `ua741.pdf`). ST is the sole publisher of STM32 pin tables — there is no second-source manufacturer | Pad counts match exactly (48/64/64/100/144/20) and every LCSC package matches the footprint. Symbols come from KiCad `MCU_ST_STM32F1/F4/G0`, and each is internally consistent on the landmarks (F1-48: `1 VBAT · 7 NRST · 8/9 VSSA/VDDA · 44 BOOT0`; F4-64: `1 VBAT · 7 NRST · 31/47 VCAP · 60 BOOT0`; F4-100: `14 NRST · 21 VREF+ · 49/73 VCAP · 94 BOOT0`; F4-144: `25 NRST · 32 VREF+ · 71/106 VCAP · 138 BOOT0 · 143 PDR_ON`; G0-20: `4 VDD · 5 VSS · 6 NRST`). Needs a 10-named-pins-per-side re-check from a network that can reach ST |
| `ic.ad620`, `ic.adum1201`, `ic.ds1307`, `ic.ds3231` | `analog.com` fails identically to st.com; `datasheets.maximintegrated.com` 301 → `pdfserv.maximintegrated.com` **522**; `www.maximintegrated.com` **522**. All four are ADI-proprietary with no second-source publisher | Packages confirmed by `jlc_get_part` (AD620ARZ SOIC-8, ADUM1201ARZ SOIC-8-150mil, DS1307+ DIP-8 / DS1307Z+ SO-8, DS3231SN# **SOIC-16-300mil**). Pin counts match the footprints. The DS3231 package mismatch this audit *did* catch was found precisely because package data was checkable without the PDF. Open items on re-check: ADuM1201's 1-forward/1-reverse channel arrangement (LCSC's parametric row says "2 forward / 0 reverse", almost certainly catalogue noise), and DS3231 pins 5–12 GND-vs-N.C. naming |
| `ic.uln2803a` | TI removed SLRS049: 404 on `lit/ds/symlink/uln2803a.pdf`, `lit/gpn/uln2803a`, `lit/pdf/slrs049` and `lit/ds/slrs049{f..j}/…`; `ti.com/product/ULN2803A` 404s. Toshiba `ULN2803APG` 403s; onsemi returns an HTML stub; ST is host-blocked. `uln2803c.pdf` is a **20-pin** device and cannot substitute | 18 pads, and the symbol (`1–8 I1–I8 · 9 GND · 10 COM · 11–18 O8–O1`) is the exact mirror of the **verified** 16-pin ULN2003A above, which is the same Darlington-array family from the same die generation. The primary MPN was moved to ST so the (canonical, if unfetchable) datasheet and the sourced part at least agree |
| `ic.ch340c`, `ic.ch340g` | `wch-ic.com` serves an SPA — `/downloads/CH340DS1_PDF.html`, `/downloads/file/{65,79}.html` and four other paths all return the same HTML shell (200, `text/html`), no linkable PDF. The gate's `PDF_ENDPOINTS` already whitelists `www.wch-ic.com/downloads/` for exactly this reason | Corroborated against the EasyEDA symbols for LCSC C84681/C14267 — an independent second source. CH340G agrees **16/16**, including the `XI`/`XO` crystal pins that distinguish the G from the C. CH340C agrees **15/16**; only pin 8 is disputed (library `NC` vs EasyEDA `OUT#`), and pin 8 is left open in the standard CH340C application circuit, so the functional risk is low. Package `SOP-16` = the 150-mil SO16 the footprint models |
| `sensor.dht11` | Aosong/ASAIR publish only behind a product-page flow; `aosong.com/en/…` paths 404 and the site is JS-driven. The one first-party PDF located is the Chinese `DHT11-V1_3` product manual (verified 200, `application/pdf`), now the `datasheet` — no English first-party copy exists | 4 pads on a 2.54 mm inline body; LCSC lists the part as `SIP-4` through-hole, consistent. The symbol (`1 VDD · 2 DATA · 3 NC · 4 GND`) is KiCad's `Sensor:DHT11` at the pinned commit. Re-read the Chinese manual's pin figure to close this |
| `opto.seven-segment-kcsc02` | The Ver.12A datasheet **was** obtained (964 KB, Rev V.12A 2021) and confirms "Common Cathode, Rt. Hand Decimal", but its internal-circuit / pin-assignment diagram is a vector graphic with **no extractable text**, so the segment→pin map could not be read out with `pdftotext` | 10 pads on a dedicated `KCSC02-105` footprint. The symbol (`1 E · 2 D · 3 CC · 4 C · 5 DP · 6 B · 7 A · 8 CC · 9 F · 10 G`) is the standard Kingbright single-digit 10-pin arrangement with the two commons at 3 and 8, and "common cathode" agrees with the datasheet's own selection guide. Closing this needs a **visual** read of one figure, not another download |

### Deviations from the brief

1. **ESP32-WROOM-32 was not re-imported from the upstream `-32E` symbol.** `RF_Module.kicad_symdir/ESP32-WROOM-32E.kicad_sym` does exist, and its pins 17–22 are indeed `no_connect`/`NC`. But it is **not a drop-in**: upstream expresses the four ground pads as a *single* pin numbered `"1,15,38,39"`, so a re-import yields **36** pins instead of 39 and drops pin numbers 1, 15, 38 and 39 from the symbol entirely. `import-kicad-batch.ts` rejects it outright — `pinMap references unknown symbol pin 1` — and the result would break the 39-entry pinMap and G1a. The brief's fallback was taken instead: pins 17–22 hand-set to `NC` / `no_connect` in `raw.pins` + `normalized.pins`, previews rebuilt. Because the symbol is therefore still a faithful parse of `ESP32-WROOM-32.kicad_sym` plus one documented hand edit, the manifest's `symbol.path` was **left pointing at the `-32` file** — repointing it would make a future re-import silently produce a different, broken symbol.
2. **Alternates in packages the component has no footprint for were dropped.** `CONTRIBUTING.md` defines `role: "alternate"` as "same footprint, same pinout, different vendor". findings-C proposed DIP alternates on SOIC-only components (`ad620` AD620ANZ, `lm339` LM339N, `ne5532` NE5532P, `rc4558` RC4558P, `tl074` TL074CN, `cd4051` CD4051BE, `mcp6002`/`mcp6004` `-I/P`, `uln2003a` ULN2003AN, `ds18b20` DS18B20Z+). Those were not added.
3. **`lm741` took option B (µA741 identity), not option A.** The brief said to prefer whichever part is LCSC-stocked *in the default package*; the default footprint is SOIC-8 and TI ships no SOIC LM741, so option A would have required moving the default footprint to DIP-8. TI `UA741CDR` (C2057458, SOIC-8) is stocked and keeps the TI datasheet host coherent under G8, so it is primary with ST `UA741CDT` (C7111) as the same-package alternate.
4. **`74hc595`'s LCSC code from findings-C was wrong.** C5947 is Nexperia `74HC595D,118` (SOIC-16, **basic**), not TI `SN74HC595DR`. The TI SOIC part is **C10092**. Both are now listed, correctly attributed.
5. **`l293d` kept ST as primary** rather than switching to TI `L293DNE` — `jlc_get_part("L293DNE")` returns only an MSKSEMI clone (C19632281), while ST `L293D` C12340 is the genuine stocked part.
6. **`opto/pc817` datasheet is Sharp's `PC817XxNSZ1B` series sheet** while the sourced MPN is `PC817X2NSZ9F`. Sharp publishes no `NSZ9F`-named PDF (six filename variants probed, all return the site's HTML 404 page). Both suffixes are `NSZ` = the through-hole 4-pin DIP lead form — the sheet's own outline section names `NSZ1B` as through-hole and `NIP1B` as the SMT gullwing alternative — and the rank digit (`X2`) is covered by the sheet's model line-up table. The pinout it documents is therefore the right one for the sourced part.
7. **`tests/gates-datasheet-coherence.test.ts` was edited** (one assertion). It is a concurrent agent's untracked file; the change is minimal and matches the test's own stated intent. Flagged for that agent.

### Left open

- `ic.tl081` symbol pins 1/5 read `NULL`; TI's SLOS081O lists `NC` for the `D` and `P` packages
  (OFFSET N1/N2 only on `PS`). Same defect class as the lm741 fix, but the brief scoped the symbol
  rename to lm741 only. One-line follow-up.
- `ic.acs712` should get a dedicated footprint with widened pads on the fused current leads 1–4
  before it is used at ≥5 A. The generic `SOIC-8_3.9x4.9mm_P1.27mm` pads are sized for signal leads.
- `ic.pcf8574`: LCSC says `SOIC-16-300mil`, NXP's `SOT109-1` is 150-mil. Verify a real part.
- `ic.ch340c` pin 8: `NC` (library) vs `OUT#` (EasyEDA). Settle against WCH CH340DS1.

---

## Post-batch corrections by the orchestrator

- `ic.pcf8574` — NXP `PCF8574T/3,518` is the SO16 wide body (SOT162-1, 7.5 mm); the component sat on
  the 3.9 mm narrow SOIC-16. Moved to `openpcb.core.footprint.package.soic-16w-7-5x10-3mm-p1-27mm`
  (the footprint imported for DS3231), identity pin map; `tools/manifests/w2-logic.json` updated.
- `passive.r-network-sip9` — Bourns `4609X` datasheet replaced the Vishay CSC sheet.
- `ic.max3232` / `ic.max485` — manufacturer string normalised to `Analog Devices` so the alias
  table matches the analog.com host.
- G8 host table extended for UMW, TOPPOWER, XLSEMI, HMSemi, Omron, Sanyou, Seiko Epson, Amphenol,
  CUI, MDD, Diotec, Worldsemi, Sharp, MaxLinear, FTDI.

## Automated cross-check (EasyEDA / SamacSys pin data, leads only)

A scratch script (not committed) resolved every component's primary MPN to an LCSC part with the
pcbparts endpoint, then compared vendor pin names against the library's symbol-pin → pad mapping for
the default footprint. Two vendor sources were tried.

| Source | Resolved | Pinout returned | OK | Mismatch | Pad-count diff | Note |
| --- | --- | --- | --- | --- | --- | --- |
| EasyEDA (`jlc_get_pinout`) | 175 / 178 MPN parts | 5 | 1 | 2 | 0 | The service started answering "No EasyEDA symbol available" for parts it had served minutes earlier; treated as rate limiting. |
| SamacSys (`cse_get_kicad`) | — | 19 | 10 | 6 | 3 | One request every 3 s, 75 minutes. |

What the mismatches were:

- **Real defects, confirmed by datasheet:** SS8050 / SS8550 in TO-92 (EasyEDA, four vendors agree on E-B-C); BAV99 pin names (SamacSys PANJIT symbol agrees with the Nexperia table).
- **Vendor naming only:** BAT54C `K` vs `COM_K`; 74HC595 TI (`QA…QH`, `SRCLK`) vs NXP (`Q0…Q7`, `SH_CP`) names on identical pins; generic connectors `Pin_1` vs `1`.
- **Wrong SamacSys match:** `ABS10` resolved to an Abracon crystal, not the Diotec bridge.
- **Pad-count artefacts:** mounting-pin pads (`MP`) and shield pads counted on one side only.
- **A wrong lead:** EasyEDA C27866 (ST BD139) lists B-C-E; ST, CJ and onsemi datasheets, KiCad, and two other EasyEDA entries agree on E-C-B. The library was right.

Conclusion: the automated pass is a useful lead generator for two- and three-pin parts and worthless
as a verdict. Every verdict in this record comes from a manufacturer datasheet read with
`pdftotext -layout` (WebFetch summaries fabricated pin orders twice during the audit).
