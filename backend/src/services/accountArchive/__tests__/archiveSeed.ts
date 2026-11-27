import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Client } from "pg";

/**
 * One account with every kind of data the account archive must carry, after the
 * restore drill's seed (`services/backup/__tests__/restoreRoundTrip.test.ts` on
 * fix/restore-drill), plus what only the archive has to solve: catalogue rows
 * referenced by numeric id, an owned and a catalogue hotel chain, an id inside JSON,
 * the places/cover-photo key cycle, and credentials that must stay behind.
 */

export const U = "az-user-0001";
export const FRIEND = "az-friend-0001";
export const NOW = "2026-05-01T10:00:00Z";

/** Values that must never appear anywhere in an archive. */
export const SECRETS = [
  "SECRET-IMMICH-KEY-0001",
  "SECRET-STRAVA-TOKEN-0001",
  "SECRET-TOTP-0001",
  "SECRET-PASSWORD-HASH-0001",
  "SECRET-API-TOKEN-HASH-0001",
  "SECRET-SHARE-TOKEN-HASH-0001",
  "SECRET-CLAIM-TOKEN-0001",
];

/** Catalogue ids in the source database; the target has different ones. */
export const CATALOGUE = {
  port: 900001,
  port2: 900002,
  airport: 900003,
  station: 900004,
  ship: 900005,
  chain: 900006,
};

/**
 * The seed's port codes: not real UN/LOCODEs ("ZZ" is unassigned), so the seed
 * never collides with the real catalogue and its cleanup never has to touch a
 * catalogue row. Deleting the real Kiel by name once broke every later suite
 * that needs DEKEL (the demo seed).
 */
export const TEST_PORT_CODES = { port: "ZZKEL", port2: "ZZOSL" } as const;

export async function insert(
  client: Client,
  table: string,
  row: Record<string, unknown>
): Promise<void> {
  const columns = Object.keys(row);
  const values = columns.map((c) => {
    const v = row[c];
    return Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : v;
  });
  await client.query(
    `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT DO NOTHING`,
    values
  );
}

/** File bodies the upload path accepts: real magic numbers, then filler. */
export const BYTES = {
  jpeg: (s: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(s)]),
  png: (s: string) =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(s)]),
  heic: (s: string) =>
    Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.from(s)]),
  pdf: (s: string) => Buffer.from(`%PDF-1.4\n${s}\n%%EOF\n`),
};

export class SeedFiles {
  /** `<dir>/<name>` -> sha256, every file the account owns. */
  readonly files = new Map<string, string>();
  constructor(readonly root: string) {}

  write(dir: string, name: string, body: string | Buffer): { name: string; sha256: string } {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const target = path.join(this.root, dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    this.files.set(`${dir}/${name}`, sha256);
    return { name, sha256 };
  }
}

export async function seedCatalogue(client: Client): Promise<void> {
  await insert(client, "ports", {
    id: CATALOGUE.port,
    name: "AZ Kiel",
    lat: 54.3,
    lon: 10.1,
    unlocode: TEST_PORT_CODES.port,
  });
  await insert(client, "ports", {
    id: CATALOGUE.port2,
    name: "AZ Oslo",
    lat: 59.9,
    lon: 10.7,
    unlocode: TEST_PORT_CODES.port2,
  });
  await insert(client, "airports", {
    id: CATALOGUE.airport,
    name: "AZ Frankfurt",
    lat: 50,
    lon: 8.5,
    iata: "ZZF",
    icao: "ZZZF",
  });
  await insert(client, "rail_stations", {
    id: CATALOGUE.station,
    name: "AZ Hamburg Hbf",
    search_name: "az hamburg hbf",
    lat: 53.55,
    lon: 10,
    source_id: "az-src-hh",
  });
  await insert(client, "ships", {
    id: CATALOGUE.ship,
    name: "AZ Ship",
    cruise_line: "AZ",
    imo: "9999991",
  });
  await insert(client, "lodging_chains", { id: CATALOGUE.chain, name: "AZ Catalogue Chain" });
  await insert(client, "achievements", {
    id: "az-ach-0001",
    code: "AZ_FIRST",
    name: "First",
    description: "d",
    category: "c",
    icon: "i",
    requirementType: "flights",
    requirement: 1,
  });
}

export async function seedOtherAccount(client: Client, files: SeedFiles): Promise<void> {
  await insert(client, "users", { id: FRIEND, username: "az-friend", password_hash: "x" });
  await insert(client, "flights", {
    id: "az-friend-flight",
    user_id: FRIEND,
    dep_lat: 1,
    dep_lon: 2,
    arr_lat: 3,
    arr_lon: 4,
  });
  const receipt = files.write(
    "receipts",
    "az-friend-receipt.pdf",
    BYTES.pdf("friend receipt")
  ).name;
  files.files.delete(`receipts/${receipt}`);
  await insert(client, "receipt_uploads", {
    id: "az-friend-receipt",
    filename: receipt,
    user_id: FRIEND,
  });
  const name = files.write("documents", "az-friend-doc.pdf", BYTES.pdf("friend bytes")).name;
  files.files.delete(`documents/${name}`);
  await insert(client, "documents", {
    id: "az-friend-doc",
    user_id: FRIEND,
    stored_name: name,
    original_name: name,
    mimetype: "application/pdf",
    size_bytes: 12,
    sha256: "f",
    format: "pdf",
  });
}

/** Rows of the other account that name this one; seeded once both exist. */
export async function seedCrossLinks(client: Client): Promise<void> {
  // A companion row of the OTHER account naming this user: theirs, never exported.
  await insert(client, "companions", {
    id: "az-friend-comp",
    user_id: FRIEND,
    canonical_name: "me",
    display_name: "Me",
    search_name: "me",
    linked_user_id: U,
    updated_at: NOW,
  });
}

export async function seedAccount(client: Client, files: SeedFiles): Promise<void> {
  const avatar = files.write("profile-pictures", `${U}_1-a.png`, BYTES.png("avatar bytes"));
  await insert(client, "users", {
    id: U,
    username: "az-user",
    password_hash: "SECRET-PASSWORD-HASH-0001",
    two_factor_secret: "SECRET-TOTP-0001",
    first_name: "Ann",
  });
  await insert(client, "user_settings", {
    id: "az-settings-0001",
    user_id: U,
    data: {
      profile: { profilePicture: `/api/v1/settings/profile-picture/${avatar.name}/content` },
      theme: "dark",
    },
    immich_base_url: "https://immich.example",
    immich_api_key: "SECRET-IMMICH-KEY-0001",
    strava_access_token: "SECRET-STRAVA-TOKEN-0001",
    updated_at: NOW,
  });
  await insert(client, "api_tokens", {
    id: "az-token",
    user_id: U,
    label: "t",
    hash: "SECRET-API-TOKEN-HASH-0001",
    lookup_hash: "SECRET-API-TOKEN-HASH-0001",
  });

  await insert(client, "trips", {
    id: "az-trip-0001",
    user_id: U,
    name: "Round trip",
    updated_at: NOW,
  });
  // A package with a valid price split: importing its member must not mark it stale.
  await insert(client, "bookings", {
    id: "az-booking-0001",
    user_id: U,
    trip_id: "az-trip-0001",
    price: 500,
    currency: "EUR",
    updated_at: NOW,
  });
  await insert(client, "flights", {
    id: "az-flight-0001",
    user_id: U,
    dep_lat: 50.03,
    dep_lon: 8.57,
    arr_lat: 40.64,
    arr_lon: -73.78,
    flight_number: "LH400",
    trip_id: "az-trip-0001",
    booking_id: "az-booking-0001",
    share_key: "az-share-key-1",
  });
  // Split set after its member exists, as the app does (a member added later marks it stale).
  await client.query(`UPDATE bookings SET price_split = $1 WHERE id = 'az-booking-0001'`, [
    JSON.stringify({ mode: "manual", shares: { "az-flight-0001": 500 } }),
  ]);
  await insert(client, "cruises", {
    id: "az-cruise-0001",
    user_id: U,
    ship_id: CATALOGUE.ship,
    updated_at: NOW,
  });
  await insert(client, "cruise_stops", {
    id: "az-stop-0001",
    cruise_id: "az-cruise-0001",
    day_number: 1,
    port_id: CATALOGUE.port,
  });
  await insert(client, "cruise_legs", {
    id: "az-leg-0001",
    cruise_id: "az-cruise-0001",
    ordinal: 0,
    from_port_id: CATALOGUE.port,
    to_port_id: CATALOGUE.port2,
    distance_km: 600,
    method: "marnet",
    router_version: "1",
    updated_at: NOW,
  });
  await insert(client, "lodging_chains", {
    id: CATALOGUE.chain + 1,
    name: "AZ Own Chain",
    user_id: U,
  });
  await insert(client, "lodgings", {
    id: "az-lodging-0001",
    user_id: U,
    name: "Hotel",
    chain_id: CATALOGUE.chain,
    updated_at: NOW,
  });
  await insert(client, "lodgings", {
    id: "az-lodging-0002",
    user_id: U,
    name: "Inn",
    chain_id: CATALOGUE.chain + 1,
    updated_at: NOW,
  });
  await insert(client, "loyalty_memberships", {
    id: "az-member-0001",
    user_id: U,
    program_name: "Points",
    updated_at: NOW,
  });
  await insert(client, "lodging_membership_chains", {
    membership_id: "az-member-0001",
    chain_id: CATALOGUE.chain,
  });
  await insert(client, "lodging_membership_chains", {
    membership_id: "az-member-0001",
    chain_id: CATALOGUE.chain + 1,
  });
  await insert(client, "lodging_stays", {
    id: "az-stay-0001",
    lodging_id: "az-lodging-0001",
    user_id: U,
    trip_id: "az-trip-0001",
    updated_at: NOW,
  });
  const journey = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    user_id: U,
    dep_station_name: "A",
    dep_lat: 1,
    dep_lon: 2,
    arr_station_name: "B",
    arr_lat: 3,
    arr_lon: 4,
    departure_time: NOW,
    updated_at: NOW,
    ...extra,
  });
  await insert(
    client,
    "rail_journeys",
    journey("az-rail-0001", { dep_station_id: CATALOGUE.station })
  );
  await insert(client, "bus_journeys", journey("az-bus-0001"));
  await insert(client, "ferry_journeys", journey("az-ferry-0001"));
  for (const [id, scope] of [
    ["az-fix-0001", { ferry_journey_id: "az-ferry-0001" }],
    ["az-fix-0002", { cruise_id: "az-cruise-0001" }],
  ] as const) {
    await insert(client, "vessel_position_fixes", {
      id,
      user_id: U,
      ...scope,
      mmsi: "265177000",
      observed_at: NOW,
      received_at: NOW,
      lat: 55,
      lon: 11,
    });
  }
  await insert(client, "rental_bookings", {
    id: "az-rental-0001",
    user_id: U,
    provider: "Sixt",
    pickup_station_name: "P",
    pickup_lat: 1,
    pickup_lon: 2,
    pickup_timezone: "UTC",
    pickup_airport_id: CATALOGUE.airport,
    return_station_name: "R",
    return_lat: 3,
    return_lon: 4,
    return_timezone: "UTC",
    pickup_time: NOW,
    return_time: NOW,
    updated_at: NOW,
  });
  await insert(client, "place_categories", { id: "az-cat-0001", user_id: U, name: "Bakeries" });
  await insert(client, "places", {
    id: "az-place-0001",
    user_id: U,
    name: "Café",
    lat: 48.1,
    lon: 11.5,
    category: "custom:az-cat-0001",
    updated_at: NOW,
  });
  await insert(client, "place_visits", {
    id: "az-visit-0001",
    place_id: "az-place-0001",
    user_id: U,
    updated_at: NOW,
  });
  await insert(client, "notes", {
    id: "az-note-0001",
    user_id: U,
    body: "a note about az-trip-0001",
    occurred_at: NOW,
    occurred_zone: "UTC",
    photo_filename: files.write("note-photos", "note-1.jpg", BYTES.jpeg("note photo")).name,
    photo_mimetype: "image/jpeg",
    photo_size_bytes: 10,
    updated_at: NOW,
  });
  await insert(client, "companions", {
    id: "az-comp-0001",
    user_id: U,
    canonical_name: "bob",
    display_name: "Bob",
    search_name: "bob",
    linked_user_id: FRIEND,
    updated_at: NOW,
  });
  await insert(client, "flight_companions", {
    flight_id: "az-flight-0001",
    companion_id: "az-comp-0001",
    position: 0,
  });

  const tripPhoto = files.write("trip-photos", "trip-1.heic", BYTES.heic("trip photo"));
  files.write("trip-photos", "trip-1.heic.display.jpg", BYTES.jpeg("trip photo rendition"));
  await insert(client, "trip_photos", {
    id: "az-tp-up-0001",
    trip_id: "az-trip-0001",
    filename: tripPhoto.name,
    mimetype: "image/heic",
    size_bytes: 10,
  });
  await insert(client, "trip_photos", {
    id: "az-tp-immich-0001",
    trip_id: "az-trip-0001",
    filename: "immich-linked",
    mimetype: "image/jpeg",
    size_bytes: 0,
    immich_asset_id: "asset-1",
  });
  await insert(client, "place_visit_photos", {
    id: "az-pvp-up-0001",
    place_visit_id: "az-visit-0001",
    filename: files.write("place-photos", "visit-1.jpg", BYTES.jpeg("visit photo")).name,
    mimetype: "image/jpeg",
    size_bytes: 11,
  });
  await insert(client, "place_visit_photos", {
    id: "az-pvp-immich-0001",
    place_visit_id: "az-visit-0001",
    mimetype: "image/jpeg",
    size_bytes: 0,
    immich_asset_id: "asset-2",
  });
  await insert(client, "place_visit_photos", {
    id: "az-pvp-linked-0001",
    place_visit_id: "az-visit-0001",
    mimetype: "image/jpeg",
    size_bytes: 0,
    trip_photo_id: "az-tp-up-0001",
  });
  // The cycle: a place's cover is a photo of one of its own visits.
  await client.query(
    `UPDATE places SET cover_photo_id = 'az-pvp-up-0001' WHERE id = 'az-place-0001'`
  );
  await insert(client, "lodging_photos", {
    id: "az-lp-0001",
    lodging_id: "az-lodging-0001",
    filename: files.write("lodging-photos", "lodging-1.jpg", BYTES.jpeg("lodging photo")).name,
    mimetype: "image/jpeg",
    size_bytes: 12,
  });

  await insert(client, "trip_expenses", {
    id: "az-exp-0001",
    user_id: U,
    trip_id: "az-trip-0001",
    kind: "food",
    amount: "12.3456",
    currency: "EUR",
    updated_at: NOW,
  });
  // A roadtrip with its ride evidence (GitHub #415): the archive must carry the tour link.
  await insert(client, "trip_routes", {
    id: "az-route-0001",
    user_id: U,
    name: "Alpine day ride",
    mode: "road",
    updated_at: NOW,
  });
  await insert(client, "receipt_uploads", {
    id: "az-receipt-0001",
    filename: files.write("receipts", "receipt-1.pdf", BYTES.pdf("receipt bytes")).name,
    user_id: U,
  });
  await seedDocuments(client, files);
  await seedTravTrack(client);

  await insert(client, "user_achievements", {
    id: "az-ua-0001",
    user_id: U,
    achievement_id: "az-ach-0001",
  });
  await insert(client, "dawarich_stays", {
    id: "az-dstay-0001",
    user_id: U,
    fingerprint: "fp",
    source_start_at: NOW,
    source_end_at: NOW,
    source_lat: 1,
    source_lon: 2,
    status: "pending",
    start_at: NOW,
    end_at: NOW,
    lat: 1,
    lon: 2,
    zone: "UTC",
    point_count: 3,
    evidence: { pointDigests: ["digest-should-not-travel"], note: "kept" },
    detected_at: NOW,
    algorithm_version: 1,
    claim_token: "SECRET-CLAIM-TOKEN-0001",
    provider: "dawarich",
    provider_rev: 1,
  });
  await insert(client, "public_share_links", {
    id: "az-share-0001",
    user_id: U,
    kind: "trip",
    token_hash: "SECRET-SHARE-TOKEN-HASH-0001",
    expires_at: "2027-01-01T00:00:00Z",
    effective_expires_at: "2027-01-01T00:00:00Z",
  });
}

async function seedDocuments(client: Client, files: SeedFiles): Promise<void> {
  const doc = async (id: string, body: string, owner: Record<string, unknown> = {}) => {
    const bytes = BYTES.pdf(body);
    const stored = files.write("documents", `${id}.pdf`, bytes);
    await insert(client, "documents", {
      id,
      user_id: U,
      stored_name: stored.name,
      original_name: `Original ${id.slice(7)}.pdf`,
      mimetype: "application/pdf",
      size_bytes: bytes.length,
      sha256: stored.sha256,
      format: "pdf",
      ...owner,
    });
  };
  const link = (
    documentId: string,
    target: Record<string, unknown>,
    role: string,
    prov: string,
    extra = {}
  ) =>
    insert(client, "document_links", {
      id: `${documentId}-${Object.keys(target)[0]}`,
      document_id: documentId,
      role,
      provenance: prov,
      ...target,
      ...extra,
    });
  await doc("az-doc-trip-0001", "trip booking", { trip_id: "az-trip-0001" });
  await link("az-doc-trip-0001", { trip_id: "az-trip-0001" }, "primary", "user");
  await link("az-doc-trip-0001", { flight_id: "az-flight-0001" }, "covers", "parser");
  await link("az-doc-trip-0001", { rail_journey_id: "az-rail-0001" }, "covers", "suggestion");
  await link("az-doc-trip-0001", { cruise_id: "az-cruise-0001" }, "covers", "legacy");
  await doc("az-doc-rental-0001", "pickup photo", {
    rental_booking_id: "az-rental-0001",
    rental_category: "pickup",
  });
  await link("az-doc-rental-0001", { rental_booking_id: "az-rental-0001" }, "primary", "user", {
    rental_category: "pickup",
  });
  await link("az-doc-rental-0001", { bus_journey_id: "az-bus-0001" }, "covers", "user");
  await doc("az-doc-exp-0001", "expense receipt", { trip_expense_id: "az-exp-0001" });
  await link("az-doc-exp-0001", { trip_expense_id: "az-exp-0001" }, "primary", "user");
  await doc("az-doc-stay-0001", "stay", { lodging_stay_id: "az-stay-0001" });
  await link("az-doc-stay-0001", { lodging_stay_id: "az-stay-0001" }, "primary", "user");
  await doc("az-doc-ferry-0001", "ferry", { ferry_journey_id: "az-ferry-0001" });
  await link("az-doc-ferry-0001", { ferry_journey_id: "az-ferry-0001" }, "primary", "user");
  await doc("az-doc-visit-0001", "visit", { place_visit_id: "az-visit-0001" });
  await link("az-doc-visit-0001", { place_visit_id: "az-visit-0001" }, "primary", "user");
  await doc("az-doc-tour-0001", "ride screenshot", { trip_route_id: "az-route-0001" });
  await link("az-doc-tour-0001", { trip_route_id: "az-route-0001" }, "primary", "user");
  await doc("az-doc-unfiled-0001", "unfiled original");
}

export const POINTS = 25;

async function seedTravTrack(client: Client): Promise<void> {
  for (let i = 0; i < POINTS; i++) {
    await insert(client, "travtrack_points", {
      id: `az-pt-${String(i).padStart(4, "0")}`,
      user_id: U,
      t: new Date(Date.UTC(2026, 4, 1, 10, i)).toISOString(),
      t_s: i * 60,
      lat: 48 + i / 1000,
      lon: 11 + i / 1000,
      origin: "device",
      origin_ref: `ref-${i}`,
    });
  }
  await insert(client, "travtrack_point_links", {
    user_id: U,
    point_id: "az-pt-0003",
    entry_kind: "flight",
    entry_id: "az-flight-0001",
  });
  // The owner's choice for one day: a source picked by hand and the outliers kept.
  await insert(client, "travtrack_day_sources", {
    user_id: U,
    day: "2026-05-01",
    zone: "UTC",
    from_at: new Date(Date.UTC(2026, 4, 1)).toISOString(),
    until_at: new Date(Date.UTC(2026, 4, 2)).toISOString(),
    segments: JSON.stringify([]),
    scores: JSON.stringify([]),
    outlier_ids: JSON.stringify(["az-pt-0007"]),
    outlier_count: 1,
    breaks: JSON.stringify([]),
    bridges: JSON.stringify([]),
    best_score: 0.8,
    override_source: "device",
    outlier_decision: "keep",
    derived_at: NOW,
    updated_at: NOW,
  });
  await insert(client, "travtrack_privacy_zones", {
    id: "az-zone-0001",
    user_id: U,
    name: "Home",
    lat: 48.0,
    lon: 11.0,
    radius_m: 300,
    updated_at: NOW,
  });
}

/** Removes everything the seed wrote to a database. */
export async function cleanSeed(client: Client): Promise<void> {
  await client.query(`DELETE FROM users WHERE id IN ($1, $2) OR username LIKE 'az-%'`, [U, FRIEND]);
  await client.query(`DELETE FROM lodging_chains WHERE id >= 900000 OR name LIKE 'AZ %'`);
  // Only the rows this seed wrote, by their ids: never a catalogue row by name.
  const own: Record<string, number[]> = {
    ports: [CATALOGUE.port, CATALOGUE.port2],
    airports: [CATALOGUE.airport],
    rail_stations: [CATALOGUE.station],
    ships: [CATALOGUE.ship],
  };
  for (const [t, ids] of Object.entries(own)) {
    await client.query(`DELETE FROM ${t} WHERE id = ANY($1::int[])`, [ids]);
  }
  await client.query(`DELETE FROM achievements WHERE code = 'AZ_FIRST'`);
}
