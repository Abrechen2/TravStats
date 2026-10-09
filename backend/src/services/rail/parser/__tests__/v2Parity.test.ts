import {
  snapshotStatus,
  snapshotTemplates,
} from "../../../parsers/templates/v2/__tests__/snapshotTemplates";
import { testInputHaystack } from "../../../parsers/templates/v2/runners";
import * as fixtures from "./railFixtures";
import * as reservationFixtures from "./railReservationFixtures";
import { legacyReaders, v2Readers, type DbReaders } from "./readers";

/**
 * Plan 2026-10-09 P4b: the Deutsche Bahn readers became v2 template files.
 * This is the proof nothing was lost in the move — every rail fixture in the
 * repository, a set of variants of them, and every test input of the files,
 * read by each old reader and by the file that replaced it, gives the same
 * booking field for field (or the same "no").
 */
const texts: Array<[string, string]> = [
  ...Object.entries(fixtures).filter((e): e is [string, string] => typeof e[1] === "string"),
  ...Object.entries(reservationFixtures),
  ["CRLF confirmation", fixtures.DB_CONFIRMATION_CHANGE.replace(/\n/g, "\r\n")],
  ["CRLF 2024 ticket", fixtures.DB_ONLINE_TICKET_2024_CHANGE.replace(/\n/g, "\r\n")],
  [
    "confirmation without total",
    fixtures.DB_CONFIRMATION_SINGLE.replace(/in Höhe von 3,20 EUR/, ""),
  ],
  [
    "confirmation, blank lines",
    fixtures.DB_CONFIRMATION_CHANGE.replace(/\nRE 7\n/, "\n\nRE 7\n\n"),
  ],
  [
    "confirmation, nach too far",
    fixtures.DB_CONFIRMATION_SINGLE.replace("\nnach ", "\nx\ny\nz\nnach "),
  ],
  [
    "ticket without its products",
    fixtures.DB_ONLINE_TICKET_2024_CHANGE.replace(/^(ICE 615|IC 4711).*$/gm, ""),
  ],
  [
    "postal order, class only in text",
    fixtures.DB_POSTAL_ORDER.replace(/^Hin- und Rückfahrt.*$/m, "1. Klasse"),
  ],
  ...snapshotTemplates("rail").flatMap((t) =>
    t.testCases.map((c) => [`${t.id}: ${c.name}`, testInputHaystack(c.input)] as [string, string])
  ),
];

const READS: Array<keyof DbReaders> = [
  "parseDbConfirmation",
  "parseDbOnlineTicket",
  "parseDbPostalOrder",
  "parseDbConnectionInfo",
  "dbOrderFacts",
  "parseDbReservation",
  "isDbReservationDocument",
];

const cases = texts.flatMap(([name, text]) => READS.map((read) => [read, name, text] as const));

describe("rail templates — legacy readers and v2 files agree", () => {
  it("the snapshot activates every Deutsche Bahn file and rejects none", () => {
    const status = snapshotStatus("rail");
    expect(status.filter((t) => t.state !== "active")).toEqual([]);
    expect(status.map((t) => t.id).sort()).toEqual([
      "rail:db-confirmation",
      "rail:db-connection-info",
      "rail:db-online-ticket",
      "rail:db-order-facts",
      "rail:db-postal-order",
      "rail:db-reservation-mail",
      "rail:db-reservation-ticket",
    ]);
  });

  it("has fixtures every reader reads", () => {
    for (const read of READS.filter((r) => r !== "isDbReservationDocument")) {
      const hits = texts.filter(([, text]) => legacyReaders[read](text) !== null);
      expect([read, hits.length > 0]).toEqual([read, true]);
    }
  });

  it.each(cases)("%s — %s", (read, _name, text) => {
    const reader = read as keyof DbReaders;
    expect(v2Readers[reader](text)).toEqual(legacyReaders[reader](text));
  });
});
