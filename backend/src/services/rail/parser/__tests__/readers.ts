/**
 * The two ways a Deutsche Bahn document can be read, for tests that must hold
 * for both: the compiled-in readers they started as (`legacy/`) and the v2
 * template FILES they became (plan 2026-10-09 P4b), loaded from the bundled
 * snapshot exactly as the app loads them.
 */
import {
  snapshotTemplate,
  snapshotTemplates,
} from "../../../parsers/templates/v2/__tests__/snapshotTemplates";
import type { ParsedRailBooking } from "../types";
import {
  applyV2RailOrderFacts,
  applyV2RailTemplate,
  isReservationDocument,
  railTemplateSet,
  readRailReservation,
  type RailOrderFacts,
} from "../v2Rail";
import * as confirmation from "./legacy/dbConfirmation";
import * as onlineTicket from "./legacy/dbOnlineTicket";
import * as reservation from "./legacy/dbReservation";

export interface DbReaders {
  parseDbConfirmation: (text: string) => ParsedRailBooking | null;
  parseDbOnlineTicket: (text: string) => ParsedRailBooking | null;
  parseDbPostalOrder: (text: string) => ParsedRailBooking | null;
  parseDbConnectionInfo: (text: string) => ParsedRailBooking | null;
  dbOrderFacts: (text: string) => RailOrderFacts | null;
  parseDbReservation: (text: string) => ParsedRailBooking | null;
  isDbReservationDocument: (text: string) => boolean;
}

export const legacyReaders: DbReaders = {
  parseDbConfirmation: confirmation.parseDbConfirmation,
  parseDbOnlineTicket: onlineTicket.parseDbOnlineTicket,
  parseDbPostalOrder: confirmation.parseDbPostalOrder,
  parseDbConnectionInfo: confirmation.parseDbConnectionInfo,
  dbOrderFacts: confirmation.dbOrderFacts,
  parseDbReservation: reservation.parseDbReservation,
  isDbReservationDocument: reservation.isDbReservationDocument,
};

const byTemplate =
  (id: string) =>
  (text: string): ParsedRailBooking | null =>
    applyV2RailTemplate(snapshotTemplate(id), text);
const set = () => railTemplateSet(snapshotTemplates("rail"));

export const v2Readers: DbReaders = {
  parseDbConfirmation: byTemplate("rail:db-confirmation"),
  parseDbOnlineTicket: byTemplate("rail:db-online-ticket"),
  parseDbPostalOrder: byTemplate("rail:db-postal-order"),
  parseDbConnectionInfo: byTemplate("rail:db-connection-info"),
  dbOrderFacts: (text) => applyV2RailOrderFacts(snapshotTemplate("rail:db-order-facts"), text),
  parseDbReservation: (text) => readRailReservation(set(), text),
  isDbReservationDocument: (text) => isReservationDocument(set(), text),
};

export const READERS: Array<[string, DbReaders]> = [
  ["legacy reader", legacyReaders],
  ["v2 template", v2Readers],
];
