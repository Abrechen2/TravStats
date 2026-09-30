/**
 * Point-to-country, against the vendored Natural Earth 1:10m outlines.
 *
 * Every coordinate here is a real place, and the two Baltic ones are the case
 * that started the work: the owner drove through Estonia and Lithuania, and
 * neither country can exist in a logbook that stores only flights, cruises and
 * hotels (design §8).
 *
 * The microstate block is the honesty §8.3 demands. It does not claim the
 * resolution is good enough; it MEASURES which countries it can and cannot
 * answer, so nobody has to rediscover the limit from a wrong passport.
 */

import { getCountryResolver, countryCodeAt, CountryResolver } from "../countryFromCoordinates";
import { loadCountryBoundaryIndex, CountryBoundaryIndex } from "../countryBoundaries";

let resolver: CountryResolver;
let index: CountryBoundaryIndex;

/**
 * The same question asked WITHOUT the grid and without the latitude bands —
 * only the per-part bounding box survives. Both the correctness check and the
 * work check below compare against this: it is the "obvious first cut" the two
 * real accelerations have to beat, and having it here means neither claim rests
 * on a remembered number.
 */
function referenceCountryAt(ix: CountryBoundaryIndex, lat: number, lon: number): string | null {
  const insideRing = (ring: number): boolean => {
    let inside = false;
    for (let v = ix.ringStart[ring]; v < ix.ringStart[ring + 1] - 1; v++) {
      const lonA = ix.coords[v * 2];
      const latA = ix.coords[v * 2 + 1];
      const lonB = ix.coords[v * 2 + 2];
      const latB = ix.coords[v * 2 + 3];
      if (latA > lat !== latB > lat) {
        if (lon < ((lonB - lonA) * (lat - latA)) / (latB - latA) + lonA) inside = !inside;
      }
    }
    return inside;
  };
  for (let part = 0; part < ix.partCodes.length; part++) {
    const box = part * 4;
    if (
      lon < ix.partBox[box] ||
      lon > ix.partBox[box + 2] ||
      lat < ix.partBox[box + 1] ||
      lat > ix.partBox[box + 3]
    ) {
      continue;
    }
    const first = ix.partRingStart[part];
    const last = ix.partRingStart[part + 1];
    if (!insideRing(first)) continue;
    let hole = false;
    for (let ring = first + 1; ring < last; ring++) {
      if (insideRing(ring)) {
        hole = true;
        break;
      }
    }
    if (!hole) return ix.partCodes[part];
  }
  return null;
}

/** Fixed seed: a random test that fails only sometimes teaches nothing. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** One point per 30 s along a Tallinn → Vilnius drive, jittered off the road. */
function balticDrive(count: number): Array<[number, number]> {
  const next = seeded(4242);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const t = (i % 5000) / 5000;
    points.push([
      59.437 + (54.687 - 59.437) * t + (next() - 0.5) * 0.02,
      24.754 + (25.28 - 24.754) * t + (next() - 0.5) * 0.02,
    ]);
  }
  return points;
}

/**
 * An index whose two hot arrays count their element reads.
 *
 * `coords` is read once per vertex a ray cast touches and `partBox` once per
 * bounding-box test, so the two counters are the work the lookup does — the
 * edges it walks and the parts it considers — as a number that no other
 * process on the machine can change.
 */
function countingIndex(ix: CountryBoundaryIndex): {
  index: CountryBoundaryIndex;
  reads: { coords: number; partBox: number };
} {
  const reads = { coords: 0, partBox: 0 };
  const counted = (array: Float64Array, key: keyof typeof reads): Float64Array =>
    new Proxy(array, {
      get(target, property) {
        if (typeof property === "string" && /^\d+$/.test(property)) reads[key]++;
        return Reflect.get(target, property, target);
      },
    });
  return {
    index: { ...ix, coords: counted(ix.coords, "coords"), partBox: counted(ix.partBox, "partBox") },
    reads,
  };
}

/** The work one lookup function does over a set of points. */
function workFor(
  ix: CountryBoundaryIndex,
  lookup: (ix: CountryBoundaryIndex, lat: number, lon: number) => string | null,
  points: ReadonlyArray<readonly [number, number]>
): { coords: number; partBox: number } {
  const { index: counting, reads } = countingIndex(ix);
  for (const [lat, lon] of points) lookup(counting, lat, lon);
  return { ...reads };
}

beforeAll(async () => {
  resolver = await getCountryResolver();
  index = await loadCountryBoundaryIndex();
}, 60_000);

describe("the countries nobody logged", () => {
  it("resolves Estonia — the country the owner drove through", () => {
    expect(resolver.countryAt(59.437, 24.7536)).toBe("EE"); // Tallinn
    expect(resolver.countryAt(58.378, 26.729)).toBe("EE"); // Tartu
  });

  it("resolves Lithuania", () => {
    expect(resolver.countryAt(54.6872, 25.2797)).toBe("LT"); // Vilnius
    expect(resolver.countryAt(54.8985, 23.9036)).toBe("LT"); // Kaunas
  });

  it("keeps the two sides of a land border apart", () => {
    // Valga (EE) and Valka (LV) are one town split by the border; the two
    // town halls are 2.6 km apart. This is the shape the whole feature turns
    // on — a drive that crosses a line with nothing to mark it in the data.
    expect(resolver.countryAt(57.777, 26.047)).toBe("EE");
    expect(resolver.countryAt(57.76, 26.017)).toBe("LV");

    // The Via Baltica crossing at Saločiai/Grenctāle, 2 km either side.
    expect(resolver.countryAt(56.15, 25.3)).toBe("LT");
    expect(resolver.countryAt(56.19, 25.3)).toBe("LV");
  });

  it("crosses Switzerland, Liechtenstein and Austria along one meridian", () => {
    // 9.55°E cuts the whole 23 km length of Liechtenstein: CH below 47.05,
    // LI through the middle, AT above 47.22.
    expect(resolver.countryAt(47.03, 9.55)).toBe("CH");
    expect(resolver.countryAt(47.14, 9.55)).toBe("LI");
    expect(resolver.countryAt(47.25, 9.55)).toBe("AT");
  });
});

describe("abstention", () => {
  it("returns null at sea rather than the nearest coast", () => {
    expect(resolver.countryAt(30, -40)).toBeNull(); // mid-Atlantic
    expect(resolver.countryAt(-20, -140)).toBeNull(); // mid-Pacific
    expect(resolver.countryAt(58.5, 20.0)).toBeNull(); // Baltic, between EE and SE
  });

  it("returns null in Antarctica, which is in the data and deliberately unindexed", () => {
    expect(resolver.countryAt(-89.99, 0)).toBeNull(); // South Pole
    expect(resolver.countryAt(-63.5, -57.0)).toBeNull(); // Antarctic Peninsula
    expect(resolver.codes.has("AQ")).toBe(false);
  });

  it("returns null where Natural Earth itself attributes nobody", () => {
    // Each of these is a real, inhabited or claimed place that the dataset
    // leaves unassigned. Handing it to whoever claims it would be exactly the
    // invented value the country rework exists to remove.
    expect(resolver.countryAt(9.56, 44.065)).toBeNull(); // Hargeisa, Somaliland
    expect(resolver.countryAt(35.19, 33.36)).toBeNull(); // northern Nicosia
    expect(resolver.countryAt(35.1707, 33.3609)).toBeNull(); // the UN buffer zone through Nicosia
    expect(resolver.countryAt(21.87, 33.6)).toBeNull(); // Bir Tawil
    // …and the recognised side of the same island still resolves.
    expect(resolver.countryAt(34.7071, 33.0226)).toBe("CY"); // Limassol
    expect(resolver.countryAt(2.0469, 45.3182)).toBe("SO"); // Mogadishu
  });

  it("returns null for a coordinate that is not one", () => {
    expect(resolver.countryAt(Number.NaN, 10)).toBeNull();
    expect(resolver.countryAt(10, Number.NaN)).toBeNull();
    expect(resolver.countryAt(Number.POSITIVE_INFINITY, 0)).toBeNull();
    expect(resolver.countryAt(91, 0)).toBeNull();
    expect(resolver.countryAt(-91, 0)).toBeNull();
    expect(resolver.countryAt(0, 181)).toBeNull();
    expect(resolver.countryAt(0, -181)).toBeNull();
  });
});

describe("enclaves and holes", () => {
  it("answers the enclave, not the country wrapped around it", () => {
    expect(resolver.countryAt(-29.3142, 27.4869)).toBe("LS"); // Maseru, inside ZA
    expect(resolver.countryAt(-29.19, 27.45)).toBe("ZA"); // Ladybrand, 15 km away
    expect(resolver.countryAt(43.9346, 12.4473)).toBe("SM"); // San Marino, inside IT
    expect(resolver.countryAt(44.0605, 12.5695)).toBe("IT"); // Rimini
  });
});

describe("what 1:10m can and cannot represent — design §8.3", () => {
  const RESOLVABLE: ReadonlyArray<[string, number, number, string]> = [
    ["Monte-Carlo", 43.7396, 7.4276, "MC"],
    ["San Marino città", 43.9346, 12.4473, "SM"],
    ["Vaduz", 47.141, 9.5209, "LI"],
    ["Malbun, the far side of Liechtenstein", 47.1027, 9.6089, "LI"],
    ["Andorra la Vella", 42.5063, 1.5218, "AD"],
    ["Gibraltar", 36.1408, -5.3536, "GI"],
    ["Singapore", 1.3521, 103.8198, "SG"],
    ["Valletta", 35.8997, 14.5146, "MT"],
    ["Hong Kong", 22.3193, 114.1694, "HK"],
    ["Macau", 22.1987, 113.5439, "MO"],
    ["Nauru", -0.5228, 166.9315, "NR"],
  ];

  it.each(RESOLVABLE)("resolves %s", (_name, lat, lon, expected) => {
    expect(resolver.countryAt(lat, lon)).toBe(expected);
  });

  it("CANNOT resolve Vatican City, and the failure is the outline, not a missing country", () => {
    // Measured 2026-09-02 on the vendored file: Natural Earth's Vatican polygon
    // has SEVEN vertices and spans 0.11 km x 0.12 km. The real city is
    // 1.05 km x 0.85 km, so roughly 1 % of it is inside the outline and the
    // blob sits off to one side. A GPS point in St Peter's Square is therefore
    // answered IT, and no resolution Natural Earth publishes fixes it.
    //
    // Pinned rather than skipped because §8.3 forbids a microstate silently
    // never appearing: a reader of this test knows Vatican City will show up as
    // Italy, instead of finding out from a passport. Finer boundaries (OSM,
    // geoBoundaries) are the only fix and are a separate decision.
    expect(resolver.countryAt(41.9022, 12.4539)).toBe("IT"); // St Peter's Square
    expect(resolver.countryAt(41.9038, 12.4581)).toBe("IT"); // the Vatican Museums

    // The country is in the dataset — this is a geometry limit, not a gap.
    expect(resolver.codes.has("VA")).toBe(true);
    expect(resolver.countryAt(41.90335, 12.45335)).toBe("VA"); // inside the 110 m blob
  });

  it("OVER-claims Monaco: its outline reaches about a kilometre into France", () => {
    // Same measurement: the Monaco polygon spans 5.75 km x 5.05 km against a
    // real country of 3.2 km x 1.1 km. Beausoleil is a French commune and comes
    // back MC. Recorded so a country-day in France is not debugged as a bug in
    // the sweep.
    expect(resolver.countryAt(43.744, 7.4247)).toBe("MC");
  });

  it("cannot represent 26 countries at 1:110m, which is why the file is 10 MB", () => {
    // The countries the smaller dataset has no polygon for at all. If this ever
    // fails, the vendored resolution was quietly downgraded.
    const microstates = [
      "LI",
      "MC",
      "SM",
      "VA",
      "AD",
      "MT",
      "SG",
      "BH",
      "MV",
      "KN",
      "GD",
      "VC",
      "LC",
      "AG",
      "BB",
      "SC",
      "TV",
      "NR",
      "MH",
      "PW",
      "FM",
      "KI",
      "TO",
      "WS",
      "ST",
      "MU",
    ];
    expect(microstates.filter((code) => !resolver.codes.has(code))).toEqual([]);
  });

  it("keeps Kosovo under the user-assigned code the rest of the world uses", () => {
    // XK is NOT ISO 3166-1 — it is user-assigned, and `Intl.DisplayNames` names
    // it "Kosovo". Kept rather than dropped because Kosovo is somewhere a
    // traveller can be, and abstaining would make a visit invisible. Pinned so
    // the choice is visible to whatever counts these codes.
    expect(resolver.countryAt(42.6629, 21.1655)).toBe("XK");
  });
});

describe("the index", () => {
  it("agrees with an unindexed reference over a global random sample", () => {
    // The latitude-band edge index is the one piece of real cleverness here: a
    // ray cast visits only the edges bucketed at the query latitude. If a band
    // ever failed to register an edge that crosses it, the answer would be
    // wrong in a way no city probe would catch. So: same question, asked
    // without the grid and without the bands.
    const next = seeded(777);
    let land = 0;
    const disagreements: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const lat = next() * 180 - 90;
      const lon = next() * 360 - 180;
      const fast = countryCodeAt(index, lat, lon);
      const slow = referenceCountryAt(index, lat, lon);
      if (slow) land++;
      if (fast !== slow) disagreements.push(`${lat},${lon}: ${fast} vs ${slow}`);
    }
    expect(disagreements).toEqual([]);
    expect(land).toBeGreaterThan(500); // the sample actually touched land
  }, 120_000);

  it("classifies a sweep with far less work than a bounding-box prefilter alone", () => {
    // The sweep of design §8.4 walks a whole location history month by month,
    // so the cost per point decides whether it is a background job or a
    // weekend. Two accelerations carry it: the 1° grid, which hands a query
    // only the parts whose box touches its cell, and the per-ring latitude
    // bands, which let a ray cast visit only the edges at the query latitude.
    //
    // This used to be a wall-clock ratio (indexed points/s over reference
    // points/s, floor 3x). A ratio of two timings is not a property of the
    // code: under a loaded box it measured 2.9 three times in one night and
    // passed alone every time. What the ratio stood for is WORK, and work can
    // be counted exactly — every vertex read and every bounding-box read goes
    // through the counters above, so the same points give the same numbers on
    // any machine at any load.
    //
    // The comparison is deliberately the FAVOURABLE case for the reference —
    // three small Baltic polygons, not Canada's 30 000-edge outline.
    const points = balticDrive(2_000);

    // Every point of the simulated drive is on land in EE, LV or LT, and the
    // counted index answers exactly what the plain one does.
    const { index: counting } = countingIndex(index);
    for (const [lat, lon] of points) {
      const answer = countryCodeAt(index, lat, lon);
      expect(answer).not.toBeNull();
      expect(countryCodeAt(counting, lat, lon)).toBe(answer);
    }

    const indexed = workFor(index, countryCodeAt, points);
    const reference = workFor(index, referenceCountryAt, points);

    // The bands: the indexed cast reads a small fraction of the vertices the
    // reference reads along the same drive. Measured 2026-09-27 over these
    // 2 000 points: 173 544 reads against 5 898 656, a factor of 34.
    expect(indexed.coords * 10).toBeLessThan(reference.coords);
    // The grid: the reference box-tests every one of the ~4 000 parts per
    // point; the grid offers only the handful whose box touches the cell.
    // Measured the same run: 9 970 reads against 4 824 364, a factor of 484.
    expect(indexed.partBox * 100).toBeLessThan(reference.partBox);
  }, 120_000);

  it("answers the same question the same way twice", () => {
    const first = resolver.countryAt(58.378, 26.729);
    const second = resolver.countryAt(58.378, 26.729);
    expect(first).toBe(second);
    expect(first).toBe("EE");
  });
});
