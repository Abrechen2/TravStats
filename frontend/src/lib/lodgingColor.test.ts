import { describe, it, expect } from "vitest";
import { DOMAINS } from "../shared/domains";
import {
  DEFAULT_LODGING_COLOR_CONFIG,
  LODGING_COLOR,
  buildLodgingLegend,
  lodgingColorFromStored,
  resolveLodgingColor,
  slotsForMode,
  type LodgingColorConfig,
} from "./lodgingColor";

const cfg = (mode: LodgingColorConfig["mode"]): LodgingColorConfig => ({
  ...DEFAULT_LODGING_COLOR_CONFIG,
  mode,
});

describe("LODGING_COLOR", () => {
  it("is derived from DOMAINS.lodging.color, not a second hardcoded literal", () => {
    // Derived rather than written out: the point of the case is that there is
    // exactly ONE lodging colour, and a literal here would be the second one.
    // It was `#d4778f` until 2.7.0 moved the domain hues onto the Companion's
    // set, and the literal is what made this case fail for the right reason at
    // the wrong moment.
    const hex = DOMAINS.lodging.color;
    const n = parseInt(hex.slice(1), 16);
    expect(LODGING_COLOR).toEqual([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  });
});

describe("resolveLodgingColor", () => {
  it("paints every house alike in the default mode — nothing changes for someone who never opens the panel", () => {
    const a = resolveLodgingColor({ type: "hotel" }, DEFAULT_LODGING_COLOR_CONFIG);
    const b = resolveLodgingColor({ type: "campsite", chainId: 3 }, DEFAULT_LODGING_COLOR_CONFIG);
    expect(a).toEqual(LODGING_COLOR);
    expect(b).toEqual(a);
  });

  it("separates the types when asked to", () => {
    const hotel = resolveLodgingColor({ type: "hotel" }, cfg("type"));
    const zelt = resolveLodgingColor({ type: "campsite" }, cfg("type"));
    expect(zelt).not.toEqual(hotel);
  });

  it("treats an unknown type as no information, not as a category of its own", () => {
    // A row whose type the app does not know must not get a colour that reads
    // as a meaningful class — it falls back to the neutral.
    expect(resolveLodgingColor({ type: "iglu" }, cfg("type"))).toEqual(
      DEFAULT_LODGING_COLOR_CONFIG.colors.solid
    );
  });

  it("an unrated house is not a badly rated one", () => {
    const bewertet = resolveLodgingColor({ overallRating: 4 }, cfg("rating"));
    const ohne = resolveLodgingColor({ overallRating: null }, cfg("rating"));
    expect(ohne).not.toEqual(bewertet);
    // Deliberately NOT a red/green scale: the distinction is "judged" vs "not",
    // and BRAND.md keeps state off colour alone anyway.
    expect(ohne).toEqual(DEFAULT_LODGING_COLOR_CONFIG.colors.unrated);
  });

  it("a rating of 1 still counts as rated", () => {
    // `!= null` and not truthiness: a 0 or a 1 is an opinion, not a gap.
    expect(resolveLodgingColor({ overallRating: 1 }, cfg("rating"))).toEqual(
      DEFAULT_LODGING_COLOR_CONFIG.colors.rated
    );
  });

  it("tells a chain from an independent house", () => {
    const kette = resolveLodgingColor({ chainId: 7 }, cfg("chain"));
    const frei = resolveLodgingColor({ chainId: null }, cfg("chain"));
    expect(kette).not.toEqual(frei);
  });
});

describe("buildLodgingLegend", () => {
  it("returns one row in the default mode, in the brand colour", () => {
    const rows = buildLodgingLegend();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("swatch");
    expect(rows[0].color).toEqual(LODGING_COLOR);
  });

  it("follows the mode — the legend cannot show fewer classes than the map paints", () => {
    // This is the whole point of deriving both from one config: a five-colour
    // map with a one-row legend would be a lie about what the reader is seeing.
    for (const mode of ["solid", "type", "rating", "chain"] as const) {
      expect(buildLodgingLegend(cfg(mode))).toHaveLength(slotsForMode(mode).length);
    }
  });

  it("every row's colour is the one the map would paint", () => {
    const c = cfg("type");
    for (const row of buildLodgingLegend(c)) {
      expect(row.color).toEqual(c.colors[row.slot]);
    }
  });
});

describe("lodgingColorFromStored", () => {
  it("falls back to the default for an empty or unknown blob", () => {
    expect(lodgingColorFromStored({})).toEqual(DEFAULT_LODGING_COLOR_CONFIG);
    expect(lodgingColorFromStored({ lodgingColorMode: "nonsense" })).toEqual(
      DEFAULT_LODGING_COLOR_CONFIG
    );
  });

  it("keeps a stored mode and repairs only the broken colours around it", () => {
    const gelesen = lodgingColorFromStored({
      lodgingColorMode: "type",
      lodgingColors: { hotel: [1, 2, 3], campsite: "kaputt" },
    });
    expect(gelesen.mode).toBe("type");
    expect(gelesen.colors.hotel).toEqual([1, 2, 3]);
    expect(gelesen.colors.campsite).toEqual(DEFAULT_LODGING_COLOR_CONFIG.colors.campsite);
  });
});
