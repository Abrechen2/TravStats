/**
 * The leaderboard and trip sharing across servers are two protocols on one crypto layer (spec
 * 2026-10-20 §4, "Separation, enforced"). This holds them apart, as
 * `frontend/src/components/encryptedShare/__tests__/separation.test.ts` does in the browser:
 * neither side imports the other, no packet of one parses as the other, and the leaderboard's
 * totals snapshot still cannot hold a record's field.
 */
import fs from "fs";
import path from "path";
import { packetBody } from "../../../federation/contract";
import { leaderboardSnapshotSchema } from "../../../../schemas/comparison";
import { tripSharePacket } from "../../../../schemas/tripSharePeer";
import * as facts from "../../facts";

const SRC = path.join(__dirname, "..", "..", "..", "..");

function sources(target: string): string[] {
  const full = path.join(SRC, target);
  if (!fs.statSync(full).isDirectory()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? // A test may read both sides; it is the shipped code that must not.
        entry.name === "__tests__"
        ? []
        : sources(path.join(target, entry.name))
      : /\.ts$/.test(entry.name)
        ? [path.join(full, entry.name)]
        : []
  );
}

const COMPARISON = ["services/comparison", "routes/comparisonPeer.ts", "schemas/comparison.ts"];
const TRIP_SHARE = [
  "services/sharing/federation",
  "schemas/tripSharePeer.ts",
  "routes/tripSharePeer.ts",
];

/** Every module a file imports, resolved to a path under `src/` (relative imports only). */
function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const specs = [...text.matchAll(/(?:from|import\(|require\()\s*["']([^"']+)["']/g)].map(
    (m) => m[1]
  );
  return specs
    .filter((s) => s.startsWith("."))
    .map((s) =>
      path
        .relative(SRC, path.resolve(path.dirname(file), s))
        .split(path.sep)
        .join("/")
    );
}
const reaches = (imported: string, targets: string[]) =>
  targets.some((t) => {
    const bare = t.replace(/\.ts$/, "");
    return imported === bare || imported.startsWith(`${bare}/`);
  });

describe("comparison and trip sharing stand apart", () => {
  it.each([
    ["the comparison side", COMPARISON, TRIP_SHARE],
    ["the trip-share side", TRIP_SHARE, COMPARISON],
  ])("nothing on %s imports the other side", (_name, from, to) => {
    const offenders = from.flatMap(sources).flatMap((file) =>
      importsOf(file)
        .filter((imported) => reaches(imported, to))
        .map((imported) => `${path.relative(SRC, file)} -> ${imported}`)
    );
    expect(offenders).toEqual([]);
  });

  it("finds an import across the line when one is there (positive control)", () => {
    const probe = path.join(SRC, "services/sharing/federation/transport.ts");
    expect(importsOf(probe).some((i) => reaches(i, ["services/federation"]))).toBe(true);
    expect(reaches("services/comparison/remote", COMPARISON)).toBe(true);
    expect(reaches("schemas/tripSharePeer", TRIP_SHARE)).toBe(true);
  });

  it("keeps the two discriminators apart: comparison has `action`, trip sharing has none", () => {
    const actions = packetBody.options.map((o) => o.shape.action.value as string);
    const tripActions = tripSharePacket.options.flatMap((o) =>
      "action" in o.shape ? [String((o.shape as { action: { value: unknown } }).action.value)] : []
    );
    expect(actions.length).toBeGreaterThan(0);
    expect(tripActions).toEqual([]);
    expect(actions.filter((a) => tripActions.includes(a))).toEqual([]);
  });

  it("parses no comparison packet as a trip message and no trip message as a comparison packet", () => {
    const trip = [
      {
        kind: "ping",
        messageId: "00000000-0000-4000-8000-000000000001",
        sentAt: "2026-10-20T00:00:00Z",
      },
    ];
    const comparison = packetBody.options.map((o) => ({ action: o.shape.action.value }));
    for (const body of comparison) expect(tripSharePacket.safeParse(body).success).toBe(false);
    for (const body of trip) {
      expect(tripSharePacket.safeParse(body).success).toBe(true);
      expect(packetBody.safeParse(body).success).toBe(false);
      expect(packetBody.safeParse({ ...body, action: "ping" }).success).toBe(false);
    }
  });
});

describe("the leaderboard snapshot still cannot hold a record", () => {
  const FACT_FIELDS = [
    ...new Set(
      Object.entries(facts)
        .filter(([name, value]) => /_FACT_FIELDS$/.test(name) && Array.isArray(value))
        .flatMap(([, value]) => value as readonly string[])
    ),
  ].sort();
  const snapshot = {
    schema: "travstats-leaderboard",
    version: 1,
    asOf: "2026-10-20T00:00:00.000Z",
    year: null,
    domains: ["flight"],
    metrics: { flights: 3 },
    partial: [],
  };

  it("reads the fact lists of every shareable type", () => {
    expect(FACT_FIELDS.length).toBeGreaterThan(50);
    expect(FACT_FIELDS).toEqual(expect.arrayContaining(["flightNumber", "depIcao", "name"]));
    expect(leaderboardSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it.each(FACT_FIELDS)("refuses %s beside the totals", (field) => {
    expect(leaderboardSnapshotSchema.safeParse({ ...snapshot, [field]: "x" }).success).toBe(false);
  });

  it.each(FACT_FIELDS)("refuses %s as a metric that carries anything but a number", (field) => {
    for (const value of ["x", { v: 1 }, [1]])
      expect(
        leaderboardSnapshotSchema.safeParse({ ...snapshot, metrics: { [field]: value } }).success
      ).toBe(false);
  });
});
