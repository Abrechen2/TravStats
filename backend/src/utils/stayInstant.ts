// The FULL dataset. geo-tz's default is "now", which folds every zone that
// keeps today's clock into one name: Bangkok came back as Asia/Jakarta
// (CAMP-03). `moduleResolution: node` cannot see this exports subpath, so
// tsconfig `paths` maps its types; Node resolves it at runtime as it is.
import { find as findTimezone } from "geo-tz/all";
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

/** The IANA zone a coordinate pair sits in, or null when it has none. */
export function timezoneOfLodging(lat?: number | null, lon?: number | null): string | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    // geo-tz returns the zones covering the point, most specific first. An
    // empty array is a real answer for open ocean, so it abstains rather than
    // falling back to UTC.
    const [zone] = findTimezone(lat, lon);
    return zone ?? null;
  } catch {
    // A coordinate outside the dataset's range throws rather than returning
    // nothing. Treated as "no zone known", not as an error worth failing a
    // whole banner over.
    return null;
  }
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
