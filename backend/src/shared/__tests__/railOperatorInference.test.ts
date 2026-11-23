import { inferRailOperator } from "../railOperatorInference";

const DE = { depCountry: "DE", arrCountry: "DE" };

// Mirrored by the frontend twin; keep both tables identical.
describe("inferRailOperator", () => {
  it.each([
    ["ICE", "633", "Hannover Hbf", "München Hbf", "DB Fernverkehr"],
    ["ICE", "1132", "Hannover Hbf", "München Hbf", "DB Fernverkehr"],
    ["IC", "1920", "Bielefeld Hbf", "Hannover Hbf", "DB Fernverkehr"],
    ["IC", "2017", "Bielefeld Hbf", "Hannover Hbf", "DB Fernverkehr"],
    ["EC", "114", "Hamburg Hbf", "Berlin Hbf", "DB Fernverkehr"],
    ["ECE", "114", "Hamburg Hbf", "Berlin Hbf", "DB Fernverkehr"],
    ["S", "8", "München Flughafen", "München Ost", "S-Bahn München"],
    ["M", "79047", "Rosenheim", "München Hbf", "Meridian"],
    ["M", "79056", "München Hbf", "Rosenheim", "Meridian"],
  ])("%s %s %s → %s is %s", (cat, num, dep, arr, expected) => {
    expect(
      inferRailOperator({
        trainCategory: cat,
        trainNumber: num,
        depStationName: dep,
        arrStationName: arr,
        ...DE,
      })
    ).toBe(expected);
  });

  it("abstains without a category (Rosenheim–Günzburg, Neufahrn–Flughafen)", () => {
    for (const [dep, arr] of [
      ["Rosenheim", "Günzburg"],
      ["Neufahrn (b Freising)", "München Flughafen"],
    ]) {
      expect(
        inferRailOperator({ trainNumber: "4711", depStationName: dep, arrStationName: arr, ...DE })
      ).toBeNull();
      expect(
        inferRailOperator({ trainCategory: "  ", depStationName: dep, arrStationName: arr, ...DE })
      ).toBeNull();
    }
  });

  it("abstains for regional trains whose operator depends on the region", () => {
    for (const trainCategory of ["RE", "RB", "REX", "TER"]) {
      expect(inferRailOperator({ trainCategory, trainNumber: "5", ...DE })).toBeNull();
    }
  });

  it("abstains outside Germany and where the country is unknown", () => {
    expect(
      inferRailOperator({ trainCategory: "IC", depCountry: "AT", arrCountry: "AT" })
    ).toBeNull();
    expect(
      inferRailOperator({ trainCategory: "EC", depCountry: "DE", arrCountry: "CH" })
    ).toBeNull();
    expect(inferRailOperator({ trainCategory: "IC" })).toBeNull();
    expect(
      inferRailOperator({ trainCategory: "ICE", depCountry: "FR", arrCountry: "NL" })
    ).toBeNull();
  });

  it("names an ICE that leaves Germany, and refuses an S-Bahn or M outside the evidence", () => {
    expect(inferRailOperator({ trainCategory: "ICE", depCountry: "DE", arrCountry: "AT" })).toBe(
      "DB Fernverkehr"
    );
    expect(
      inferRailOperator({ trainCategory: "S", trainNumber: "1", depStationName: "Hamburg", ...DE })
    ).toBeNull();
    expect(inferRailOperator({ trainCategory: "M", trainNumber: "12", ...DE })).toBeNull();
  });
});
