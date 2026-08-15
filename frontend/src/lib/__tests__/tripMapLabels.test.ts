import { describe, it, expect } from "vitest";
import { declutterByDistance, labelBudget, pickLabelled } from "../../components/map/labelPriority";

/**
 * The trip map must reveal names the way the main map does. It did not:
 * `buildLodgingPins` was called with a FIXED zoom and `labelsMode: "all"`,
 * which switches the whole pipeline off — so a round trip through eleven
 * Madagascan hotels printed eleven names on top of each other at every zoom.
 *
 * Two mechanisms do the work, and for a trip-sized set they do NOT do the same
 * job: the count budget only bites above ~10 labels, while the distance pass
 * bites immediately, because the hotels of one trip sit far closer together
 * than the airports the budget was tuned for. Both are pinned here.
 */

/** The eight located hotels of the owner's Madagascar trip, as they really are. */
const MADAGASKAR: Array<{ name: string; position: [number, number] }> = [
  { name: "Hôtel Belvedere", position: [47.52, -18.91] },
  { name: "San Cristobal Boutique Hotel", position: [47.46, -18.83] },
  { name: "Hotel Feon' ny Ala", position: [48.42, -18.95] },
  { name: "Arotel", position: [47.03, -19.87] },
  { name: "Soa Lia Hotel", position: [45.46, -19.54] },
  { name: "Hotel Restaurant du Menabe", position: [44.54, -19.7] },
  { name: "L'Olympe du Bemaraha", position: [44.8, -19.14] },
  { name: "Kimony Resort Hotel", position: [44.31, -20.26] },
];

const gewicht = (): number => 1;
const ort = (d: { position: [number, number] }): readonly [number, number] => d.position;

describe("Zählgrenze der Beschriftungen", () => {
  it("wächst mit dem Zoom und ist bei Weltansicht klein", () => {
    expect(labelBudget(1)).toBe(5);
    expect(labelBudget(2)).toBeGreaterThan(labelBudget(1));
    expect(labelBudget(6)).toBeGreaterThan(labelBudget(4));
  });

  it("greift erst, wenn es mehr Namen als Platz gibt", () => {
    // Acht Häuser passen bei Zoom 2 alle ins Budget — deshalb ist die
    // Zählgrenze für eine Reise NICHT das Mittel, das hilft. Das Bild sauber
    // hält der Abstandsfilter darunter.
    expect(pickLabelled(MADAGASKAR, gewicht, "important", 2)).toHaveLength(MADAGASKAR.length);

    const viele = Array.from({ length: 40 }, (_, i) => ({
      name: `H${i}`,
      position: [i, 0] as [number, number],
    }));
    expect(pickLabelled(viele, gewicht, "important", 2).length).toBeLessThan(viele.length);
    expect(pickLabelled(viele, gewicht, "all", 2)).toHaveLength(viele.length);
    expect(pickLabelled(viele, gewicht, "off", 2)).toHaveLength(0);
  });
});

describe("Abstandsfilter — was auf einer Reisekarte wirklich hilft", () => {
  it("legt zwei Namen an derselben Stelle nicht übereinander", () => {
    // Belvedere und San Cristobal liegen beide in Antananarivo, rund 10 km
    // auseinander. Bei Weltansicht ist das weniger als ein Bildpunkt.
    const antananarivo = MADAGASKAR.slice(0, 2);
    expect(declutterByDistance(antananarivo, gewicht, ort, 2)).toHaveLength(1);
  });

  it("lässt beide stehen, sobald man nah genug heran ist", () => {
    const antananarivo = MADAGASKAR.slice(0, 2);
    expect(declutterByDistance(antananarivo, gewicht, ort, 12)).toHaveLength(2);
  });

  it("dünnt die ganze Rundreise bei Weltansicht aus, ohne sie zu leeren", () => {
    const sichtbar = declutterByDistance(MADAGASKAR, gewicht, ort, 2);
    expect(sichtbar.length).toBeGreaterThan(0);
    expect(sichtbar.length).toBeLessThan(MADAGASKAR.length);
  });

  it("zeigt beim Hineinzoomen wieder alle", () => {
    expect(declutterByDistance(MADAGASKAR, gewicht, ort, 11)).toHaveLength(MADAGASKAR.length);
  });
});
