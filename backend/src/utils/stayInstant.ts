import { zoneOf } from "../shared/time/zoneOf";
import { legacyFakeUtcToRealUtc } from "./timezone";

/**
 * WHEN a stay begins, as an instant — not as a date.
 *
 * `LodgingStay.checkIn` is a UTC-pinned midnight day anchor and `checkInTime`
 * ("HH:mm") says when on that day the stay actually starts. Every other reader
 * wants the pure day (FX, nights, status, `shared/lodgingTiming.ts`); a
 * countdown is the one consumer that needs a real instant, and combining the
 * two naively gets it wrong.
 *
 * The naive combination reads the wall clock AS UTC. A tester reported the
 * consequence (#331): a 22:30 check-in in Berlin was counted down to 22:30Z,
 * which is 00:30 the next morning locally, so the banner said "in 1 hour" for
 * a stay beginning in three.
 *
 * **Whose clock is 22:30?** Not the viewer's: a German planning a hotel in
 * Tokyo types the time the HOTEL will expect them, and a countdown against the
 * reader's own zone would be wrong for every trip that leaves the country —
 * which is the entire product. Not a profile setting either: there is none, and
 * inventing one would still answer with the traveller's home clock rather than
 * the hotel's. It is the hotel's own clock, and the hotel's coordinates say
 * which that is — the same derivation `services/airportLookup.ts` already makes
 * for every airport it stores.
 *
 * Without coordinates the honest answer is the old one. A stay with no location
 * has no clock to borrow, and guessing a zone would put a wrong number on
 * screen in the one place a reader trusts to be exact. So the wall clock is
 * returned unconverted, exactly as before, and the caller cannot tell the two
 * cases apart — which is correct, because for a same-zone stay they agree.
 *
 * @deprecated → `shared/time` (ADR 0002): phase 2 stores the stay's zone and
 * check-in instant (`toInstant`), and phase 6 deletes this file. The zone and
 * the conversion already go through `zoneOf` / `legacyFakeUtcToRealUtc`.
 */

export interface StayInstantSource {
  /** The day anchor: UTC-pinned midnight. */
  checkIn: Date;
  /** "HH:mm" on that day, or null when only the day is known. */
  checkInTime: string | null;
  /** The hotel's position, when it has one. */
  lat?: number | null;
  lon?: number | null;
}

/**
 * The IANA zone a coordinate pair sits in, or null when it has none.
 * Throws `ZoneLookupUnavailableError` (TIMEZONE_LOOKUP_UNAVAILABLE) when the lookup itself is broken — that used
 * to be swallowed here, and every stay and rail station silently got UTC.
 */
export function timezoneOfLodging(lat?: number | null, lon?: number | null): string | null {
  return zoneOf({ lat, lon });
}

/**
 * The instant a stay begins.
 *
 * Returns the day anchor untouched when no time of day is recorded — a stay
 * known only to the day genuinely has no instant, and midnight is the
 * convention every other reader already uses for it.
 */
export function stayStartsAt(stay: StayInstantSource): Date {
  const { checkIn, checkInTime } = stay;
  if (!checkInTime) return checkIn;

  const [hours, minutes] = checkInTime.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return checkIn;

  // The wall clock, encoded as UTC — the same shape `legacyFakeUtcToRealUtc`
  // expects, and the value this function used to return outright.
  const wallClock = new Date(checkIn.getTime() + (hours * 60 + minutes) * 60_000);

  const zone = timezoneOfLodging(stay.lat, stay.lon);
  if (!zone) return wallClock;

  return legacyFakeUtcToRealUtc(wallClock, zone);
}
