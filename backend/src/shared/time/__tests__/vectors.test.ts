import fs from "fs";
import { appliesToServer, runCase } from "./runVectors";
import {
  loadVectors,
  tzdataSatisfies,
  VECTOR_ERROR_CODES,
  VECTOR_OPS,
  VECTORS_SCHEMA_PATH,
} from "./vectorFile";

/**
 * The server against the shared conformance vectors (ADR 0002 D5), in this
 * process's zone. `vectors.oddZones.test.ts` runs the same file under UTC+14
 * and UTC−3:30.
 */

const file = loadVectors();

describe("shared/time/vectors.json — the format", () => {
  it("carries a version header and a tzdata floor this runtime meets", () => {
    expect(file.version).toBeGreaterThanOrEqual(1);
    expect(tzdataSatisfies(file.minTzdata)).toBe(true);
  });

  it("agrees with vectors.schema.json on the ops and error codes a runner must know", () => {
    const schema = JSON.parse(fs.readFileSync(VECTORS_SCHEMA_PATH, "utf8"));
    expect(schema.$defs.case.properties.op.enum).toEqual([...VECTOR_OPS]);
    expect(schema.$defs.errorCode.enum).toEqual([...VECTOR_ERROR_CODES]);
  });

  it("covers every op the server implements", () => {
    const serverOps = new Set(file.cases.filter(appliesToServer).map((c) => c.op));
    expect([...serverOps].sort()).toEqual(
      ["floatingDate", "localDay", "span", "toInstant", "toLocal", "todayIn"].sort()
    );
  });
});

describe("shared/time — server vectors in the default zone", () => {
  it.each(file.cases.filter(appliesToServer).map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const result = runCase(c);
    // On failure the message carries both sides; instants compare as instants.
    expect(
      result.ok ? "ok" : JSON.stringify({ actual: result.actual, expected: result.expected })
    ).toBe("ok");
  });
});
