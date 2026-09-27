/**
 * Seeds THE demo account: one believable traveller from the Rhineland, with
 * ten years of trips from Köln/Bonn and Düsseldorf — city breaks, long-haul
 * holidays with connections, special flights, cruises, train journeys,
 * roadtrips by car, motorhome and motorbike, and hikes and a cycle tour with
 * real recorded tracks. The content lives in `seedDemo/realistic/`; this file
 * owns the account itself: who it is, how it is reset, and its settings.
 *
 * It replaced a COVERAGE seed on 2026-09-26 (owner: "mehr realistische
 * Reisen"): 160 flights spread over every status and year between random
 * airports read like nobody's life. Feature coverage that tests need lives on
 * in the dev admin (`seedDevAdmin.ts`, `seedDemo/coverageCruises.ts`).
 *
 * Idempotent: deletes all existing data for user "demo" and re-creates it,
 * dated relative to the run's own "now" so the account never goes stale.
 *
 * Invoked on first install (when no users exist yet) — by `init.ts` in
 * development and by `docker-entrypoint.sh` in the image — and on every boot
 * with CREATE_DEMO_USER=true, via the `seed:demo` npm script:
 *
 *   DATABASE_URL=... npx tsx src/seedDemoAccount.ts
 *   npm run seed:demo               # uses dist/seedDemoAccount.js
 */

import { Prisma } from "./prisma";
import { prisma } from "./db";
import { hashPassword, comparePassword } from "./utils/password";
import { DEMO_USERNAME } from "./utils/sharedDemo";
import { appVersion } from "./utils/version";
import { checkAndUpdateAchievements } from "./utils/achievements";
import { AVAILABLE_DOMAINS } from "./shared/domains";
import { seedRealisticDemo } from "./seedDemo/realistic";
import { fillSeededTimeColumns } from "./services/timeModel/seedTimeColumns";
import { ensureDemoCatalogues, enableBetaForDemo } from "./seedDemo/instance";

const DEMO_PASSWORD = "demo123";

/** Where the demo traveller lives, and the two airports they fly from — CGN the default. */
const HOME_RESIDENCE = { name: "Köln", lat: 50.9375, lon: 6.9603 };
const HOME_AIRPORT = "CGN";
const SECOND_HOME_AIRPORT = "DUS";

// ---------------------------------------------------------- main seed logic

/**
 * EVERY model in `prisma/schema.prisma` that belongs to one user, and what
 * happens to it here. Written down because the wipe missed thirteen of them
 * until the independent review of 2026-09-17 (finding A7), and because the
 * next model with a `userId` will be noticed only if this list is read — a
 * cascade you cannot see is indistinguishable from a table nobody thought of.
 *
 * Deleted by this function (34). Rows, not files — an uploaded receipt or
 * training sample leaves its bytes on disk, as `demoGuard.uploads.test.ts`
 * notes, which is why the upload routes refuse the account outright:
 *   AnalyticsEvent · Booking · Companion · CountryDay · Cruise ·
 *   CruiseStop · DataQualityFlag · DawarichSweepState · Document · Flight ·
 *   ImportBatch ·
 *   Lodging · LodgingStay · LoyaltyMembership · PairingCode ·
 *   ParseTrainingLog · ParserTemplate · PasswordResetRequest ·
 *   PendingFlightUpdate ·
 *   PendingUpdateStatistics · PhotoJourney · Place · PlaceList · PlaceVisit ·
 *   RailJourney · ReceiptUpload · TrainingData · Trip · TripJournalEntry ·
 *   TripRoute · TripStop · TripSuggestionDecision · UserAchievement ·
 *   LodgingChain (only the account's OWN chains, `userId` set)
 *
 * Deleted by CASCADE from one of those, so they need no statement of their
 * own — each reaches the user through exactly one owner:
 *   CruiseCompanion, CruiseLeg, CruiseLegRoute, CruiseTrack (Cruise) ·
 *   FlightCompanion (Flight/Companion) · RailJourneyCompanion (RailJourney/Companion) ·
 *   ImmichImportJob (TripImmichAlbum) ·
 *   LodgingPhoto (Lodging) · LodgingMembershipChain,
 *   LodgingMembershipLodging (LoyaltyMembership) · PlaceListEntry
 *   (PlaceList/Place) · PlaceVisitPhoto (PlaceVisit) · TripCompanion,
 *   TripImmichAlbum, TripPhoto (Trip) · TripRouteLeg, TripRouteTrack
 *   (TripRoute)
 *
 * Deliberately NOT deleted here, each for a stated reason:
 *   ApiToken, TwoFactorRecoveryCode, WebAuthnCredential — `ensureUser`
 *     removes them BEFORE this runs, together with the credential reset, so a
 *     live session is ended before the first row is deleted (finding I4).
 *   UserSettings — rewritten rather than removed, by `ensureUserSettings`
 *     right after this; deleting it would drop the enabled domains the seeded
 *     account needs and is what the upsert exists to avoid.
 *   Invitation — reaches a user through TWO relations (creator and redeemer)
 *     and is instance-level admin data. The demo cannot create one; deleting
 *     invitations it happened to touch would destroy an admin's records.
 *
 * `Document` is the newest of them and the reason the count moved from 29 to
 * 30: it arrived from main with `routes/documents.ts` AFTER this enumeration
 * was written on 2026-09-17, so the sweep that produced the list never saw it.
 *
 * NOT user-owned at all, and never to be deleted here: Airport, Airline,
 * Aircraft, Ship, Port, LodgingChain (the catalogue's rows, `userId` null),
 * Achievement, CuratedList, CuratedPlace,
 * AdminSettings, SmtpConfig, Backup, AirportSeedingStatus, PoiBackfillAudit.
 * Those are the global catalogues every account reads — which is exactly why
 * the shared demo account may not write to them (finding A3).
 */
async function wipeDemoUser(userId: string): Promise<void> {
  // Cascade-safe teardown: deleting the user would wipe all owned rows via
  // onDelete: Cascade, but we want to keep the user row stable so we just
  // delete owned data. Order matters where there are optional FKs.
  //
  // New domains (Tasks 5-8: narrated trips, tours, lodging, places) go first —
  // deleted before flights/cruises/trips so a stale FK never outlives the row
  // it points at. PlaceVisit before PlaceList before Place: entries cascade
  // off the list, but a place can still be a visit target until visits are
  // gone. LodgingStay before Lodging for the same reason. TripJournalEntry and
  // TripRoute (legs/tracks cascade with it) before TripStop, because
  // TripRouteLeg cascades off either its route OR its endpoint stops — routes
  // first means the legs are already gone by the time stops are deleted, and
  // TripStop.routeId is SetNull on route delete rather than blocking it.
  // Companion last of the new set: its join rows (FlightCompanion,
  // CruiseCompanion) cascade, so it's safe regardless of flight/cruise order.
  // Before everything it hangs off. A document FILED with an entry dies by
  // cascade with that entry, but an UNFILED one has no owner but the user, so
  // it outlived the reseed by up to `UNLINKED_TTL_DAYS` (7 days) with its bytes
  // still readable through `GET /documents/:id/file`. `routes/documents.ts`
  // arrived from main after the wipe was enumerated on 2026-09-17, so `Document`
  // was never in any of the three lists above — an omission, not a decision
  // (security audit of 2026-09-19, finding 1). Rows only: the bytes under
  // `uploads/documents/` are the orphan sweep's business, which is the second
  // reason the upload route now refuses the shared account outright.
  await prisma.document.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.placeList.deleteMany({ where: { userId } }); // entries cascade
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.lodgingStay.deleteMany({ where: { userId } });
  await prisma.lodging.deleteMany({ where: { userId } });
  await prisma.tripJournalEntry.deleteMany({ where: { trip: { userId } } });
  await prisma.tripRoute.deleteMany({ where: { userId } }); // legs/tracks cascade
  await prisma.tripStop.deleteMany({ where: { trip: { userId } } });
  await prisma.companion.deleteMany({ where: { userId } }); // join rows cascade

  await prisma.cruiseStop.deleteMany({
    where: { cruise: { userId } },
  });
  await prisma.cruise.deleteMany({ where: { userId } });
  // Train rides arrived with the rail domain after the list above was drawn
  // up, and so did the inbox's answers and the account's own hotel chains.
  // The realistic account (2026-09-26) writes all three; without these lines a
  // reseed doubled every ride and left the old chain row in the way of the new.
  await prisma.railJourney.deleteMany({ where: { userId } }); // companion links cascade
  await prisma.tripSuggestionDecision.deleteMany({ where: { userId } });
  // Before the flights it hangs off, so the row goes whether or not the
  // cascade fires. See the enumeration below.
  await prisma.pendingFlightUpdate.deleteMany({ where: { userId } });
  await prisma.flight.deleteMany({ where: { userId } });
  await prisma.booking.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await prisma.userAchievement.deleteMany({ where: { userId } });
  await prisma.analyticsEvent.deleteMany({ where: { userId } });

  /**
   * The twelve tables below were ALL missed until the independent review of
   * 2026-09-17 (finding A7). The wipe covered the domains a visitor is shown
   * — flights, cruises, trips, lodging, places — and nothing else, so a public
   * instance accumulated the shared account's leavings for as long as it ran:
   * a hotel loyalty number, an import batch naming an uploaded file, a parser
   * template trained on somebody's booking mail, an uploaded receipt, a
   * location-history sweep cursor, an unspent pairing code.
   *
   * `ImportBatch` goes LAST of all: flights, cruises, lodgings, stays and
   * places point at it with `onDelete: SetNull`, so the order is not required
   * for correctness, but deleting the batch after its contents keeps the
   * reading obvious.
   */
  await prisma.countryDay.deleteMany({ where: { userId } });
  await prisma.dataQualityFlag.deleteMany({ where: { userId } });
  await prisma.dawarichSweepState.deleteMany({ where: { userId } });
  await prisma.loyaltyMembership.deleteMany({ where: { userId } }); // links cascade
  await prisma.pairingCode.deleteMany({ where: { userId } });
  await prisma.parseTrainingLog.deleteMany({ where: { userId } });
  await prisma.parserTemplate.deleteMany({ where: { userId } });
  // An ADMIN INBOX item — "this account asked to have its password reset" —
  // carrying no token, which is why the omission cost nothing that could be
  // spent. What it did cost was an administrator's attention: the row outlived
  // every reset (data-integrity audit 2026-09-19, finding 7), so a public
  // instance left an open task about an account that no longer holds the data
  // the request was raised for, and the account is one whose password is
  // printed on the login page. The table arrived on 2026-09-19 (migration
  // `20260919140631_password_reset_requests`) and was in none of the three
  // lists above, exactly as `Document` had been two days earlier.
  await prisma.passwordResetRequest.deleteMany({ where: { userId } });
  await prisma.pendingUpdateStatistics.deleteMany({ where: { userId } });
  await prisma.photoJourney.deleteMany({ where: { userId } });
  await prisma.receiptUpload.deleteMany({ where: { userId } });
  await prisma.trainingData.deleteMany({ where: { userId } });
  await prisma.importBatch.deleteMany({ where: { userId } });
  // After the lodgings that point at them (SetNull either way): the account's
  // own chains. The catalogue's rows have `userId` null and are never touched.
  await prisma.lodgingChain.deleteMany({ where: { userId } });
}

export async function ensureUser(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { username: DEMO_USERNAME },
  });
  if (existing && !existing.isDemo) {
    // An unflagged row named `demo` is one of two things, and they must not be
    // treated alike.
    //
    // It is the built-in demo account created by a pre-2.5.0 version, which
    // wrote no `isDemo` at all — or it is a real person who happened to pick
    // the name on their own instance. `utils/sharedDemo.ts` already states the
    // difference ("`demo` without the flag is a user who happened to pick the
    // name"), and nothing held the seeder to it: it reset whatever it found.
    //
    // Measured by the data-integrity audit of 2026-09-19 (finding 1) against a
    // real row with `isDemo: false`, a private password hash and a first name:
    // one boot with CREATE_DEMO_USER=true published that person's login as
    // demo/demo123, removed their passkeys, recovery codes, API tokens and
    // two-factor secret, nulled their name and birthdate, and deleted their
    // rows from thirty tables. Nothing about the run was reversible and
    // nothing about it was visible in the UI afterwards.
    //
    // The PASSWORD tells the two apart, and `scripts/backfillDemoFlag.ts`
    // already answers the same question the same way — "the account is
    // identified by its seeded password, not by its name alone". A legacy demo
    // row still carries `demo123`, so it is healed and reseeded exactly as
    // before; a real person's account carries something else, and the seeder
    // refuses rather than reseeding it. One bcrypt compare, only on a boot
    // that finds an unflagged `demo` at all.
    const isLegacyDemoRow = await comparePassword(DEMO_PASSWORD, existing.passwordHash);
    if (!isLegacyDemoRow) {
      throw new Error(
        `A user named "${DEMO_USERNAME}" exists, is not flagged as the demo account, and does ` +
          `not carry the seeded demo password — refusing to reseed. Rename that account (or ` +
          `delete it) before enabling CREATE_DEMO_USER.`
      );
    }
  }
  if (existing) {
    // Restore the account itself BEFORE its data. The route guards should
    // already refuse a credential/2FA/token change on the demo account
    // server-side — this is the second line of defence, in case one of those
    // guards is ever missed or bypassed: every re-seed puts the account back
    // to a known-good, publicly-documented login.
    //
    // The order matters and used to be the other way round. `wipeDemoUser`
    // deletes a few thousand rows across twenty tables; a visitor whose
    // session is still live goes on writing for the whole of that window and
    // leaves rows behind the delete has already passed. Bumping `sessionEpoch`
    // first ends every session issued before this instant, so the wipe runs
    // against an account nobody can reach (final review finding I4).
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        isDemo: true,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        mustChangePassword: false,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: null,
        twoFactorToken: null,
        twoFactorTokenExpiry: null,
        // Whatever a visitor typed about themselves. The name is read by the
        // header greeting on every page and the birthdate feeds an
        // achievement, so both are shown to the next visitor and both
        // survived every reseed until now (finding I1).
        firstName: null,
        lastName: null,
        birthdate: null,
        // The account-takeover chain: set the notification address, ask
        // /auth/forgot-password for a link, own the shared login (finding C3).
        // Both guards that close it are newer than some installs, so the
        // address and any outstanding token are cleared here as well.
        notificationEmail: null,
        resetToken: null,
        resetTokenExpiry: null,
        changeToken: null,
        changeTokenExpiry: null,
        // A reset of a shared public login must end sessions issued before
        // it, exactly like every other credential reset (routes/auth.ts,
        // routes/admin/users.ts, routes/passwordReset.ts) — otherwise a
        // visitor's live demo JWT survives this reset.
        sessionEpoch: { increment: 1 },
      },
    });
    await prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: existing.id } });
    await prisma.webAuthnCredential.deleteMany({ where: { userId: existing.id } });
    await prisma.apiToken.deleteMany({ where: { userId: existing.id } });
    await wipeDemoUser(existing.id);
    return existing.id;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.create({
    data: {
      username: DEMO_USERNAME,
      passwordHash,
      mustChangePassword: false,
      // This seeder is the one the Docker entrypoint runs (CREATE_DEMO_USER),
      // and it did NOT set the flag, while the other demo seeder
      // (seedDemoUser) always has. Measured on a production install: the demo
      // account existed with is_demo = false, so its 160 sample flights and 22
      // sample cruises counted as real data in the instance-wide statistics,
      // and the demo guards in routes/flights.ts did not apply to it either.
      isDemo: true,
    },
  });
  return user.id;
}

/**
 * Both background sweeps stay OFF — historical enrichment (final review
 * finding I5) and, since the independent review of 2026-09-17 (finding A4),
 * flight auto-update beside it.
 *
 * They are the same kind of switch: each one arms a job that spends the
 * instance's flight-API quota, and on a public instance the shared account is
 * unattended by definition — the admin who pays for the key is not the person
 * clicking around in it. The route refuses both blocks and the two workers
 * skip the account, but a row flipped before either guard existed is only
 * healed here, which is why this is an explicit `false` on BOTH branches of
 * the upsert and not a default.
 *
 * `whatsNewSeenVersion` is stamped for the same reason `stampWhatsNewSeen`
 * stamps a fresh signup: nothing is "new" to an account that starts here. The
 * nightly reseed rebuilds this one from scratch, so without the stamp every
 * visitor to a public preview meets the release highlights of a version they
 * never ran before they see a single flight — measured on beta.travstats.de
 * on 2026-09-18, where the 2.6.0 modal opened over the dashboard on first
 * login and again after every reset.
 */
export async function ensureUserSettings(userId: string, now: Date = new Date()): Promise<void> {
  const data = {
    unitsSystem: "metric",
    defaultCategory: "vacation",
    welcomeSeen: true,
    whatsNewSeenVersion: appVersion,
    // Home is Köln, flying from CGN and DUS, for the whole of the account's
    // history: home loops and layovers read the airports, "away from home" in
    // the trip suggestions and "farthest from home" measure from the
    // residence. Confirmed, so the demo does not ask its own inbox question;
    // the legacy key beside it is the mirror the server itself writes.
    homePeriods: [
      {
        fromDate: `${now.getUTCFullYear() - 10}-01-01`,
        toDate: null,
        residence: HOME_RESIDENCE,
        residenceConfirmed: true,
        airports: [
          { code: HOME_AIRPORT, primary: true },
          { code: SECOND_HOME_AIRPORT, primary: false },
        ],
      },
    ],
    homeAirportHistory: [
      { iata: HOME_AIRPORT, fromDate: `${now.getUTCFullYear() - 10}-01-01`, toDate: null },
    ],
  } as Prisma.InputJsonValue;
  // Every domain the app has, the beta ones included: the demo is where a
  // visitor sees what the app can do. Whether a beta domain actually SHOWS is
  // the instance's switch — `enableBetaForDemo` — not this list.
  const enabledDomains = [...AVAILABLE_DOMAINS];
  await prisma.userSettings.upsert({
    where: { userId },
    update: {
      enabledDomains,
      data,
      historicalEnrichmentEnabled: false,
      autoUpdateEnabled: false,
    },
    create: {
      userId,
      enabledDomains,
      data,
      historicalEnrichmentEnabled: false,
      autoUpdateEnabled: false,
    },
  });
}

/**
 * Runs the full demo seed and returns the userId plus final row counts per
 * domain. Idempotent: a second call wipes and re-creates everything, landing
 * on exactly the same counts (see `seedDemo.full.test.ts`) — every writer is
 * deterministic, nothing is random.
 */
export async function runDemoSeed(
  /**
   * One instant for the whole run, taken once here, so every domain agrees on
   * what "now" is and the nightly reseed of a public instance keeps producing
   * journeys that are upcoming when it says they are (finding B6).
   */
  now: Date = new Date()
): Promise<{ userId: string; counts: Record<string, number> }> {
  const userId = await ensureUser();
  await ensureUserSettings(userId, now);
  // The badges are replayed trip by trip, in the order the trips happened,
  // each stamped with the last day of the trip that earned it (board item
  // realistic-demo-account (c)): one run at the end dated every badge with
  // the seed day, and a ten-year traveller whose every badge is from this
  // morning is the demo's tell. A trip after `now` stamps `now` — a booking
  // is made today. Live users are untouched: only this call passes a date.
  let replayFailed = false;
  const replay = async (day: Date): Promise<void> => {
    if (replayFailed) return;
    try {
      // The engine reads the time-model columns (birthday, local days).
      await fillSeededTimeColumns(userId);
      await checkAndUpdateAchievements(userId, { unlockedAt: day });
    } catch (err) {
      // Same trade as the run below: badges are not worth failing the seed.
      // The replay stops, and the final run dates what is left with today.
      replayFailed = true;
      console.warn("   ! achievement replay failed, remaining badges dated today:", err);
    }
  };
  await seedRealisticDemo(userId, now, { afterTrip: replay });
  // The time-model columns, derived from what the seed just wrote (ADR 0002).
  await fillSeededTimeColumns(userId);

  try {
    // What the trips did not earn — lists, home places — was earned today.
    await checkAndUpdateAchievements(userId, { unlockedAt: now });
  } catch (err) {
    // Achievement recompute is nice-to-have — not worth failing the seed.
    console.warn("   ! achievement recompute failed:", err);
  }

  const [flights, rail, cruises, trips, stays, places, placeLists, routes, tracks, journal] =
    await Promise.all([
      prisma.flight.count({ where: { userId } }),
      prisma.railJourney.count({ where: { userId } }),
      prisma.cruise.count({ where: { userId } }),
      prisma.trip.count({ where: { userId } }),
      prisma.lodgingStay.count({ where: { userId } }),
      prisma.place.count({ where: { userId } }),
      prisma.placeList.count({ where: { userId } }),
      prisma.tripRoute.count({ where: { userId } }),
      prisma.tripRouteTrack.count({ where: { route: { userId } } }),
      prisma.tripJournalEntry.count({ where: { trip: { userId } } }),
    ]);

  return {
    userId,
    counts: { flights, rail, cruises, trips, stays, places, placeLists, routes, tracks, journal },
  };
}

/**
 * What `npm run seed:demo` does, in order: the catalogues the demo points at,
 * the instance's beta switch, the account. Exported so a test can drive the
 * same path; it passes `catalogues: false` rather than load the rail station
 * catalogue into the shared test database.
 */
export async function seedDemoInstance(
  options: { catalogues: boolean } = { catalogues: true }
): Promise<{ userId: string; counts: Record<string, number> }> {
  // The catalogues the demo's rows point at — on a first boot the server,
  // which normally seeds them, has not started yet.
  if (options.catalogues) await ensureDemoCatalogues();
  // The demo exists to show what the app can do, beta domains included
  // (owner, 2026-09-26) — through the admin setting, not the account. Before
  // the seed, so the achievement recompute at its end already counts the rail
  // and roadtrip domains it can see.
  await enableBetaForDemo();
  return runDemoSeed();
}

async function main(): Promise<void> {
  const started = Date.now();
  console.log("🌱 Seeding demo account (demo / demo123) ...");
  const { userId, counts } = await seedDemoInstance();
  console.log("");
  console.log(`✅ Demo seed complete in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`   Username: ${DEMO_USERNAME}`);
  console.log(`   Password: ${DEMO_PASSWORD}`);
  console.log(`   user id: ${userId}`);
  for (const [k, v] of Object.entries(counts)) console.log(`   ${k}: ${v}`);
}

// Only auto-run the full demo seed when executed directly (npm run seed:demo).
// Guarded so tests can import the account functions without triggering a
// complete demo-account seed + premature $disconnect.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error("❌ Seed failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
