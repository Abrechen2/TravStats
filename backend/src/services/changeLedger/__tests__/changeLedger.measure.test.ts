import { Client } from "pg";
import request from "supertest";

import app from "../../../index";
import { observeQueries, prisma } from "../../../db";
import { ledgerStats, resetLedgerStats, setChangeLedgerEnabled } from "../capture";
import { importSheets } from "../../xlsxImport/importSheets";
import { shareTrip } from "../../sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";

/**
 * The change ledger's overhead (spec §Performance), measured on write-heavy
 * paths with the ledger on and off. Not part of the suite: it takes a minute
 * and prints numbers rather than asserting them. Run with
 * `MEASURE_CHANGE_LEDGER=1 npx jest changeLedger.measure --forceExit`.
 */
const run = process.env.MEASURE_CHANGE_LEDGER === "1" ? describe : describe.skip;

interface Sample {
  ms: number;
  observed: number;
  ledgerStatements: number;
  peakActive: number;
}

async function measure(fn: () => Promise<unknown>): Promise<Sample> {
  const watcher = new Client({ connectionString: process.env.DATABASE_URL });
  await watcher.connect();
  let peakActive = 0;
  let polling = true;
  const poll = (async () => {
    while (polling) {
      const { rows } = await watcher.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() " +
          "AND state <> 'idle' AND pid <> pg_backend_pid()"
      );
      peakActive = Math.max(peakActive, rows[0].n as number);
    }
  })();
  let observed = 0;
  const stop = observeQueries(() => {
    observed += 1;
  });
  resetLedgerStats();
  const start = process.hrtime.bigint();
  try {
    await fn();
  } finally {
    stop();
    polling = false;
    await poll;
    await watcher.end();
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const s = ledgerStats();
  // A savepoint is two statements (SAVEPOINT, RELEASE / ROLLBACK TO).
  const ledgerStatements = s.snapshotReads + s.inserts + s.savepoints * 2;
  return { ms: Math.round(ms), observed, ledgerStatements, peakActive };
}

function report(name: string, off: Sample, on: Sample): void {
  const total = (x: Sample) => x.observed + x.ledgerStatements;
  const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round(((a - b) / b) * 100)} %`);
  console.warn(
    `MEASURE ${name}: time off ${off.ms} ms / on ${on.ms} ms (${pct(on.ms, off.ms)}); ` +
      `statements off ${total(off)} / on ${total(on)} (${pct(total(on), total(off))}); ` +
      `peak active connections off ${off.peakActive} / on ${on.peakActive}`
  );
}

const flightData = (userId: string, i: number, tripId?: string) => ({
  userId,
  flightNumber: `LH${i}`,
  depIata: "MUC",
  arrIata: "FRA",
  depLat: 48.35,
  depLon: 11.79,
  arrLat: 50.03,
  arrLon: 8.57,
  departureTime: new Date(Date.UTC(2025, 4, 1, 6, i % 60)),
  arrivalTime: new Date(Date.UTC(2025, 4, 1, 7, i % 60)),
  status: "landed",
  dataSource: "manual",
  ...(tripId ? { tripId } : {}),
});

run("change ledger overhead", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    setChangeLedgerEnabled(true);
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
  });

  afterAll(async () => {
    setChangeLedgerEnabled(true);
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const bulkEdit = async (enabledLedger: boolean) => {
    await prisma.flight.deleteMany({ where: { userId: anna.id } });
    await prisma.flight.createMany({
      data: Array.from({ length: 200 }, (_, i) => flightData(anna.id, i)),
    });
    const ids = (
      await prisma.flight.findMany({ where: { userId: anna.id }, select: { id: true } })
    ).map((f) => f.id);
    setChangeLedgerEnabled(enabledLedger);
    const sample = await measure(() =>
      request(app)
        .post("/api/v1/flights/bulk-edit")
        .set("Cookie", anna.cookie)
        .send({
          flightIds: ids,
          tags: { mode: "add", values: [`t${enabledLedger}`] },
          companions: { mode: "add", values: ["Anna"] },
        })
        .expect(200)
    );
    setChangeLedgerEnabled(true);
    return sample;
  };

  it("flight bulk edit of 200", async () => {
    await bulkEdit(true); // warm-up
    const off = await bulkEdit(false);
    const on = await bulkEdit(true);
    report("bulk edit 200 flights", off, on);
  });

  const busRow = (i: number, id = "", notes = "") => ({
    id,
    operator: "Kobus",
    depStationName: "Seoul Express Bus Terminal",
    depLat: "37.5045",
    depLon: "127.0049",
    arrStationName: "Sokcho Express Bus Terminal",
    arrLat: "38.1987",
    arrLon: "128.5868",
    departureTime: new Date(Date.UTC(2024, 0, 1 + (i % 300), 10, i % 60)).toISOString(),
    arrivalTime: new Date(Date.UTC(2024, 0, 1 + (i % 300), 12, i % 60)).toISOString(),
    notes,
  });

  const xlsxReimport = async (enabledLedger: boolean) => {
    await prisma.busJourney.deleteMany({ where: { userId: anna.id } });
    await importSheets([{ key: "bus", rows: Array.from({ length: 500 }, (_, i) => busRow(i)) }], {
      userId: anna.id,
      dryRun: false,
      mode: "merge",
    });
    const rides = await prisma.busJourney.findMany({
      where: { userId: anna.id },
      select: { id: true },
      orderBy: { departureTime: "asc" },
    });
    const rows = rides.map((r, i) => busRow(i, r.id, `edit ${enabledLedger}`));
    setChangeLedgerEnabled(enabledLedger);
    const sample = await measure(() =>
      importSheets([{ key: "bus", rows }], { userId: anna.id, dryRun: false, mode: "merge" })
    );
    setChangeLedgerEnabled(true);
    return sample;
  };

  it("xlsx re-import of 500 bus rows (every row an update)", async () => {
    const off = await xlsxReimport(false);
    const on = await xlsxReimport(true);
    report("xlsx re-import 500 rows", off, on);
  }, 300_000);

  const sharedEdits = async (enabledLedger: boolean) => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Fifty" } });
    await prisma.flight.createMany({
      data: Array.from({ length: 50 }, (_, i) => flightData(anna.id, i, trip.id)),
    });
    const companion = await linkWithConsent(anna, ben);
    setChangeLedgerEnabled(enabledLedger);
    const share = await measure(() => shareTrip(anna.id, trip.id, companion.id));
    const ids = (
      await prisma.flight.findMany({ where: { userId: anna.id }, select: { id: true } })
    ).map((f) => f.id);
    const edits = await measure(async () => {
      for (const id of ids) {
        await request(app)
          .put(`/api/v1/flights/${id}`)
          .set("Cookie", anna.cookie)
          .send({ gate: `G${enabledLedger}` })
          .expect(200);
      }
    });
    setChangeLedgerEnabled(true);
    return { share, edits };
  };

  it("share propagation of a trip with 50 entries", async () => {
    const off = await sharedEdits(false);
    const on = await sharedEdits(true);
    report("share a trip of 50 flights", off.share, on.share);
    report("50 edits propagated to the member", off.edits, on.edits);
  }, 300_000);
});
