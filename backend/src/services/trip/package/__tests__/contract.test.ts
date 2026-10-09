import {
  addDays,
  arrivalDay,
  canonicalFlightNumber,
  packageSpan,
  validatePackageValues,
} from "../contract";

const base = {
  bookingReference: "9Z123456",
  issuedOn: "2026-03-02",
  flights: [
    {
      flightNumber: "ET 0707",
      date: "2026-05-18",
      depIata: "fra",
      arrIata: "ADD",
      arrDayOffset: 1,
    },
  ],
  stays: [{ name: "Savanna Lodge", checkIn: "2026-05-19", checkOut: "2026-05-23" }],
};

describe("package contract", () => {
  it("accepts a reading and canonicalises codes and flight numbers", () => {
    const checked = validatePackageValues(base);
    if (!checked.ok) throw new Error(checked.issues.join("; "));
    expect(checked.contract.flights[0]).toMatchObject({ flightNumber: "ET707", depIata: "FRA" });
  });

  it("refuses a reading without its booking reference, by path", () => {
    const checked = validatePackageValues({ ...base, bookingReference: null });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues[0]).toMatch(/^bookingReference/);
  });

  it("refuses a leg that names neither an airport nor a place", () => {
    const checked = validatePackageValues({
      ...base,
      flights: [{ flightNumber: "ET707", date: "2026-05-18", arrIata: "ADD" }],
    });
    expect(checked.ok).toBe(false);
  });

  it("refuses a stay that ends before it starts, and a price without a currency", () => {
    expect(
      validatePackageValues({
        ...base,
        stays: [{ name: "X", checkIn: "2026-05-23", checkOut: "2026-05-19" }],
      }).ok
    ).toBe(false);
    expect(validatePackageValues({ ...base, totalPrice: 100 }).ok).toBe(false);
  });

  it("reads flight numbers the airline's way", () => {
    expect(canonicalFlightNumber("GF 0086")).toBe("GF86");
    expect(canonicalFlightNumber("QR070")).toBe("QR70");
    expect(canonicalFlightNumber("U2 1234")).toBe("U21234");
    expect(canonicalFlightNumber("not a flight")).toBeNull();
  });

  it("spans the package from its own dates, else from what it names", () => {
    const checked = validatePackageValues(base);
    if (!checked.ok) throw new Error();
    expect(packageSpan(checked.contract)).toEqual({ first: "2026-05-18", last: "2026-05-23" });
    expect(packageSpan({ ...checked.contract, startDate: "2026-05-17" })?.first).toBe("2026-05-17");
  });

  it("rolls an arrival over the month end", () => {
    expect(arrivalDay({ date: "2026-05-31", arrDayOffset: 1 })).toBe("2026-06-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});
