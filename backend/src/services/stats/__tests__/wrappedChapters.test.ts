import { buildWrapped } from "../wrapped";
import { NO_CHAPTERS } from "../wrappedChapters";
import { wrappedSchema } from "../../../schemas/statsWrapped";

/**
 * forgejo#265 — the year in review tells a year with only stays, places,
 * roadtrips, tours, rentals or bus rides; each chapter is its own figure,
 * never summed across domains; a hidden domain has no chapter and no year.
 */
describe("buildWrapped — chapters beyond flights", () => {
  it("offers a year that holds only stays and a rental, and tells it", () => {
    const wrapped = buildWrapped([], [], [], null, [], {
      ...NO_CHAPTERS,
      lodging: [
        { year: 2025, nights: 3 },
        { year: 2025, nights: null },
        { year: 2023, nights: 1 },
      ],
      rentals: [{ year: 2025, days: 4 }],
    });
    expect(wrapped).toMatchObject({
      year: 2025,
      availableYears: [2023, 2025],
      flights: 0,
      rank: "other",
      chapters: {
        lodging: { stays: 2, nights: 3, nightsUnknown: 1 },
        rentals: { rentals: 1, days: 4 },
        places: null,
        bus: null,
      },
    });
    const parsed = wrappedSchema.safeParse(wrapped);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("counts distinct places, roadtrips, tours and bus rides of the asked year only", () => {
    const wrapped = buildWrapped([], [], [], 2024, [], {
      lodging: [],
      places: [
        { year: 2024, placeId: "a" },
        { year: 2024, placeId: "a" },
        { year: 2024, placeId: "b" },
        { year: 2025, placeId: "c" },
      ],
      roadtrips: [{ year: 2024 }],
      tours: [{ year: 2024 }, { year: 2024 }],
      rentals: [],
      bus: [
        { year: 2024, distanceKm: 255.4, nights: 0 },
        { year: 2024, distanceKm: null, nights: 1 },
      ],
    });
    expect(wrapped?.chapters).toEqual({
      lodging: { stays: 0, nights: 0, nightsUnknown: 0 },
      places: { visits: 3, places: 2 },
      roadtrips: { roadtrips: 1 },
      tours: { tours: 2 },
      rentals: { rentals: 0, days: 0 },
      bus: { rides: 2, km: 255, nights: 1 },
    });
  });

  it("gives a hidden domain no chapter and no year", () => {
    expect(buildWrapped([], [], [], null, [], NO_CHAPTERS)).toBeNull();
  });
});
