import { computeFerryGeometry } from "../ferryGeometry";
import { computeSchematicRoute } from "../../schematicRouter";
jest.mock("../../schematicRouter", () => ({ computeSchematicRoute: jest.fn() }));
const ends = { depLat: 41, depLon: 16, arrLat: 42, arrLon: 18 };
it.each(["direct", "remote", "nonfinite", "chord"])(
  "refuses %s as a computed sea line",
  async (kind) => {
    const waypoints =
      kind === "remote"
        ? [
            [5, 5],
            [6, 6],
            [7, 7],
          ]
        : kind === "nonfinite"
          ? [
              [16, 41],
              [NaN, 42],
              [18, 42],
            ]
          : kind === "chord"
            ? [
                [16, 41],
                [18, 42],
              ]
            : [
                [16, 41],
                [17, 41.5],
                [18, 42],
              ];
    jest.mocked(computeSchematicRoute).mockResolvedValue({
      waypoints: waypoints as Array<[number, number]>,
      protectedPrefixCount: 0,
      protectedSuffixCount: 0,
      method: kind === "direct" ? "direct" : "maritime_graph",
      routed: kind !== "direct",
    });
    expect(await computeFerryGeometry(ends)).toBeNull();
  }
);
