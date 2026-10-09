/**
 * The two ways an issuer's lodging confirmation can be read, for tests that
 * must hold for both: the compiled-in `LodgingTemplate` the reader started as
 * (`legacy`), and the v2 template FILE it became (`v2`, plan 2026-10-09 P4a),
 * loaded from the bundled snapshot exactly as the app loads it — validated,
 * and active only because its own test cases passed.
 *
 * A test written against `READERS` is a parity test: the same fixture, the
 * same expectation, both readers.
 */
import type { ParsedLodgingBooking } from "../../parsedLodgingBooking";
import { applyLodgingTemplate } from "../engine";
import { applyV2LodgingTemplate } from "../v2Lodging";
import { LODGING_TEMPLATES as LEGACY_LODGING_TEMPLATES } from "./legacy/builtins";
import { parseBookingComEmail } from "./legacy/bookingCom";
import { createMemoryTemplateCache } from "../../../parsers/templates/v2/cache";
import { V2TemplateStore } from "../../../parsers/templates/v2/loader";
import { createDirSnapshot } from "../../../parsers/templates/v2/snapshot";
import type { TemplateEnvelope } from "../../../parsers/templates/v2/envelope";
import type { LodgingTemplate } from "../types";

export type LodgingReader = (
  id: string,
  subject: string,
  body: string
) => ParsedLodgingBooking | null;

export function legacyTemplate(id: string): LodgingTemplate {
  const found = LEGACY_LODGING_TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`No legacy template ${id}`);
  return found;
}

let snapshot: TemplateEnvelope[] | null = null;

/** Every template the bundled snapshot activates — through the real loader, never a shortcut. */
export function snapshotTemplates(): TemplateEnvelope[] {
  if (snapshot === null) {
    const store = new V2TemplateStore({
      fetchJson: () => Promise.reject(new Error("offline")),
      baseUrl: "https://templates.example.test",
      appVersion: "99.0.0",
      cache: createMemoryTemplateCache(),
      snapshot: createDirSnapshot(),
    });
    store.loadFromCache();
    snapshot = store.getActive();
  }
  return snapshot;
}

export function snapshotTemplate(id: string): TemplateEnvelope {
  const found = snapshotTemplates().find((t) => t.id === id);
  if (!found) throw new Error(`No active snapshot template ${id}`);
  return found;
}

/** The Booking.com reader was code, not a declarative spec (moved in plan P4b). */
const BOOKING_COM_ID = "lodging:booking.com";

export const legacyReader: LodgingReader = (id, subject, body) =>
  id === BOOKING_COM_ID
    ? parseBookingComEmail(subject, `${subject}\n${body}`)
    : applyLodgingTemplate(legacyTemplate(id), subject, body);

export const v2Reader: LodgingReader = (id, subject, body) =>
  applyV2LodgingTemplate(snapshotTemplate(id), subject, body);

/** Every compiled-in reader the v2 files replaced. */
export const LEGACY_IDS: readonly string[] = [
  BOOKING_COM_ID,
  ...LEGACY_LODGING_TEMPLATES.map((t) => t.id),
];

export const READERS: Array<[string, LodgingReader]> = [
  ["legacy reader", legacyReader],
  ["v2 template", v2Reader],
];
