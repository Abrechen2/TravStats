import { tiersHeldInYear } from "../loyaltyTiers";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("tiersHeldInYear", () => {
  it("is null for a card without dated history — unknown, not 'no status'", () => {
    expect(tiersHeldInYear(null, 2024)).toBeNull();
    expect(tiersHeldInYear([], 2024)).toBeNull();
  });

  it("is empty for a year the history does not touch", () => {
    expect(
      tiersHeldInYear([{ tier: "Gold", validFrom: d("2024-01-01"), validUntil: null }], 2023)
    ).toEqual([]);
  });

  it("counts a period that touches the year only on its first or last day", () => {
    const endsNewYear = [{ tier: "Gold", validFrom: d("2022-06-01"), validUntil: d("2023-01-01") }];
    const startsNewYearsEve = [{ tier: "Gold", validFrom: d("2023-12-31"), validUntil: null }];
    expect(tiersHeldInYear(endsNewYear, 2023)).toEqual(["Gold"]);
    expect(tiersHeldInYear(startsNewYearsEve, 2023)).toEqual(["Gold"]);
    expect(tiersHeldInYear(startsNewYearsEve, 2022)).toEqual([]);
  });

  it("lists every tier of the year in the order reached, each once", () => {
    const periods = [
      { tier: "Gold", validFrom: d("2024-07-01"), validUntil: null },
      { tier: "Silver", validFrom: d("2023-01-01"), validUntil: d("2024-06-30") },
      { tier: "Gold", validFrom: d("2024-01-15"), validUntil: d("2024-02-15") },
    ];
    expect(tiersHeldInYear(periods, 2024)).toEqual(["Silver", "Gold"]);
  });

  it("keeps an open-ended period running into every later year", () => {
    expect(
      tiersHeldInYear([{ tier: "Platinum", validFrom: d("2020-01-01"), validUntil: null }], 2030)
    ).toEqual(["Platinum"]);
  });
});
