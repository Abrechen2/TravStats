/**
 * Hand-placed open-water approaches for ports whose raster cell sits inside a
 * fjord or archipelago (forgejo#386, REF-16 — extracted from
 * `schematicRouter.ts` unchanged).
 */

export interface SchematicRoutePort {
  readonly id?: number;
  readonly name?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
  readonly unlocode?: string | null;
  readonly lat: number;
  readonly lon: number;
}

interface PortApproach {
  readonly match: (port: SchematicRoutePort) => boolean;
  /** [lon, lat] waypoints from the port toward open water, excluding the port itself. */
  readonly outbound: ReadonlyArray<readonly [number, number]>;
}

const PORT_APPROACHES: ReadonlyArray<PortApproach> = [
  {
    match: (port) =>
      portMatches(port, {
        names: ["hamburg"],
        cities: ["hamburg"],
        countries: ["germany", "deutschland"],
        unlocodes: ["DEHAM"],
      }),
    outbound: [
      [9.87, 53.54],
      [9.7, 53.56],
      [9.42, 53.79], // Glückstadt fairway (channel runs N of the town).
      [9.22, 53.86], // Brokdorf approach, channel-centered between river banks.
      [9.12, 53.88],
      [8.72, 53.9],
      [8.18, 54.05], // German Bight, safely outside the Elbe estuary.
    ],
  },
  {
    // Kiel sits at the southern tip of the Kieler Förde. Marnet's
    // nearest shipping-lane node sits SE in Lübeck Bay — snapping
    // there draws every Kiel route through the Holstein peninsula
    // around the south of Fehmarn island. Real cruise traffic exits
    // Kiel via the Förde, crosses the Kiel Bight, transits Fehmarnbelt
    // (between Puttgarden and Rødby), and joins the open Baltic east
    // of Lolland. This corridor encodes that path so the marnet graph
    // picks up from sensible open water.
    match: (port) =>
      portMatches(port, {
        names: ["kiel"],
        cities: ["kiel"],
        countries: ["germany", "deutschland"],
        unlocodes: ["DEKEL"],
      }),
    outbound: [
      [10.21, 54.4], // Kieler Förde mouth, north of Friedrichsort.
      [10.3, 54.5], // Kiel Bight open water, off Strande / Schilksee.
      [10.8, 54.55], // approaching Fehmarn from the west, mid-channel.
      [11.1, 54.65], // Fehmarnbelt western entry, north of Großenbrode.
      [11.4, 54.65], // Fehmarnbelt centre, between Puttgarden and Rødby.
      [11.8, 54.7], // east of Fehmarnbelt, open Bay of Mecklenburg.
      [12.3, 54.8], // open Baltic east of Lolland, marnet snap territory.
    ],
  },
  {
    // Bergen sits at the inner end of Byfjorden. The cruise channel
    // exits west via Byfjorden → north of Askøy island → Hjeltefjorden
    // → past Fedje at the fjord mouth → open North Sea. Without this
    // corridor the marnet graph snaps to a node west of Bergen across
    // mountainous terrain, drawing the route over the Norwegian
    // mainland on every Hamburg → Bergen / Bergen → anywhere leg.
    match: (port) =>
      portMatches(port, {
        names: ["bergen"],
        cities: ["bergen"],
        countries: ["norway", "norwegen"],
        unlocodes: ["NOBGO"],
      }),
    outbound: [
      [5.2, 60.42], // Byfjorden, west of Bergen city, north of Askøy.
      [4.97, 60.5], // Hjeltefjorden middle, between Askøy and Holsnøy.
      [4.78, 60.55], // Hjeltefjorden mouth, near Fedje.
      [4.4, 60.5], // Open North Sea west of the fjord system.
    ],
  },
];

function normalizePortText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function portMatches(
  port: SchematicRoutePort,
  criteria: {
    readonly names?: readonly string[];
    readonly cities?: readonly string[];
    readonly countries?: readonly string[];
    readonly unlocodes?: readonly string[];
  }
): boolean {
  const name = normalizePortText(port.name);
  const city = normalizePortText(port.city);
  const country = normalizePortText(port.country);
  const unlocode = normalizePortText(port.unlocode).toUpperCase();

  if (criteria.unlocodes?.some((code) => unlocode === code.toUpperCase())) return true;

  const countryMatches =
    criteria.countries === undefined ||
    criteria.countries.some((candidate) => country === candidate);
  if (!countryMatches) return false;

  return Boolean(
    criteria.names?.some((candidate) => name === candidate || name.includes(candidate)) ||
    criteria.cities?.some((candidate) => city === candidate)
  );
}

export function getPortApproach(port: SchematicRoutePort): [number, number][] {
  const approach = PORT_APPROACHES.find((entry) => entry.match(port));
  return approach ? approach.outbound.map(([lon, lat]) => [lon, lat]) : [];
}
