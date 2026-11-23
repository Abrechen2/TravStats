import type { UploadDirName } from "../../config/uploadDirs";

/**
 * What the account archive (forgejo#433) does with every table of the database.
 *
 * The archive moves ONE account to another TravStats server. It is built from the
 * database's own foreign keys rather than from a hand-kept list of relations, so a
 * child table (a flight's companions, a document's links) travels with its parent
 * without a line here. What a line here decides is the part the schema cannot say:
 *
 *   - `owner`     the account's rows, selected by `column = <user id>`; imported.
 *   - `child`     no user column; selected through its foreign keys into tables that
 *                 travel (every NOT NULL key must point into the archive); imported.
 *   - `catalogue` shared reference rows (airports, ports, ...). Only the ones the
 *                 account's rows point at are written, and the target resolves them
 *                 by their natural key, inserting a copy only when it has none.
 *   - `info`      written for the reader to see, never imported: shares and
 *                 federation pairings are bound to this server and its keys.
 *   - `excluded`  never written, with the reason.
 *
 * `accountArchive.policy.test.ts` holds this table against the live schema: every
 * public table must have an entry, and every entry must name a table that exists.
 * An omission and a decision must not look alike.
 */

export interface DataTableOptions {
  /** Columns written as null: credentials, server-keyed digests, share state. */
  strip?: readonly string[];
  /** Unique replay keys with no meaning elsewhere: re-keyed like an id on import. */
  rekey?: readonly string[];
  /** Text columns holding an id of another table without a foreign key. */
  idColumns?: readonly string[];
  /**
   * Too many rows to scan their text for ids (TravTrack points): only the primary
   * key, the foreign keys and `idColumns` are rewritten on import.
   */
  bulk?: boolean;
  /**
   * Written by one UPDATE after every row of the archive exists. A document's owner
   * columns: setting them on insert fires the trigger that files a primary link,
   * which the archive's own links would then collide with.
   */
  late?: readonly string[];
  /** Columns naming a stored upload: renamed with the file, and checked against it. */
  files?: readonly FileColumn[];
  /** Natural keys a reference that is not in the archive resolves by (see `catalogue`). */
  catalogue?: CatalogueSpec;
}

/**
 * A column that names an uploaded file. `name`: the stored name; the row is refused
 * when the archive does not carry a file the upload path would accept under it
 * (or, nullable, the column is cleared). `url`: a legacy URL ending in the name,
 * cleared when the file is missing. `avatar`: the settings JSON's profile picture.
 * `mime`/`format` are re-derived from the bytes, never taken from the archive.
 */
export interface FileColumn {
  column: string;
  /** The upload directory the file lives in. */
  dir: UploadDirName;
  kind: "name" | "url" | "avatar";
  mime?: string;
  format?: string;
  /** The stored row's sha256 and size, recomputed from the bytes. */
  sha256?: string;
  size?: string;
  /** Rows that only LINK a photo (Immich/PhotoPrism, another photo) carry no file. */
  linkedWhen?: readonly string[];
}

export interface CatalogueSpec {
  /** Tried in order; a key whose columns are all non-null on the row is looked up. */
  naturalKeys: readonly (readonly string[])[];
  /** Narrows the lookup, e.g. owner-less chains only. */
  where?: string;
}

export type TablePolicy =
  | ({ kind: "owner"; column: string } & DataTableOptions)
  | ({ kind: "child" } & DataTableOptions)
  | { kind: "catalogue"; spec: CatalogueSpec }
  /** `where` reads the table as `t0`; `$1` is the user id. */
  | { kind: "info"; where: string; omit?: readonly string[] }
  | { kind: "account" }
  | { kind: "excluded"; reason: string };

const owner = (opts: DataTableOptions = {}): TablePolicy => ({
  kind: "owner",
  column: "user_id",
  ...opts,
});
const child = (opts: DataTableOptions = {}): TablePolicy => ({ kind: "child", ...opts });
const excluded = (reason: string): TablePolicy => ({ kind: "excluded", reason });

const CREDENTIALS = "credential material";
const INSTANCE = "instance-wide state, no account owns it";
const CATALOGUE_UNREFERENCED =
  "catalogue no account row points at by id; re-seeded on every server";
const DERIVED = "derived from the account's rows and rebuilt on the target";
const BOOKKEEPING = "transport or job bookkeeping, meaningless on another server";
const OTHER_ACCOUNTS = "names other accounts of this server, which do not move";
const FEDERATION = "bound to this server's federation keys and peers";

/**
 * Settings columns that hold someone's credentials for a provider. The rest of the
 * settings row (base URLs of a self-hosted Immich or Dawarich included) travels.
 */
export const USER_SETTINGS_SECRETS = [
  "claude_api_key",
  "openai_api_key",
  "google_api_key",
  "google_places_api_key",
  "airlabs_api_key",
  "aviationstack_api_key",
  "aerodatabox_api_key",
  "aeroapi_api_key",
  "adsbx_api_key",
  "adsblol_api_key",
  "opensky_client_id",
  "opensky_client_secret",
  "opensky_username",
  "opensky_password",
  "immich_api_key",
  "photoprism_token",
  "dawarich_api_key",
  "graphhopper_api_key",
  "openrouteservice_api_key",
  "strava_access_token",
  "strava_refresh_token",
  "strava_token_expires_at",
  "strava_athlete_id",
  "strava_scope",
] as const;

/** Share keys tie a record to its linked copies in other accounts; shares do not move. */
const SHARE_KEY = ["share_key"] as const;

export const TABLE_POLICY: Readonly<Record<string, TablePolicy>> = {
  users: { kind: "account" },

  // Travel data.
  trips: owner({ strip: ["share_group_id"] }),
  flights: owner({
    strip: SHARE_KEY,
    files: [{ column: "receipt_url", dir: "receipts", kind: "url" }],
  }),
  flight_tracks: child(),
  flight_companions: child(),
  cruises: owner({ strip: SHARE_KEY }),
  cruise_stops: child(),
  cruise_legs: child(),
  cruise_leg_routes: child(),
  cruise_tracks: child(),
  cruise_companions: child(),
  rail_journeys: owner({ strip: SHARE_KEY }),
  rail_journey_companions: child(),
  bus_journeys: owner({ strip: SHARE_KEY }),
  bus_journey_companions: child(),
  ferry_journeys: owner({ strip: SHARE_KEY }),
  // The account's own drawn sea line per port pair (feat/ferry-route-pair): hand-drawn, not re-derivable.
  ferry_pair_routes: owner(),
  ferry_journey_companions: child(),
  // AIS positions recorded during a crossing or cruise (2026-11-22): recorded data,
  // the server's only copy of a ferry's track.
  vessel_position_fixes: owner(),
  rental_bookings: owner({ strip: SHARE_KEY }),
  rental_booking_companions: child(),
  lodgings: owner(),
  lodging_stays: owner({
    strip: SHARE_KEY,
    files: [{ column: "receipt_url", dir: "receipts", kind: "url" }],
  }),
  lodging_stay_companions: child(),
  lodging_photos: child({
    files: [{ column: "filename", dir: "lodging-photos", kind: "name", mime: "mimetype" }],
  }),
  lodging_membership_lodgings: child(),
  lodging_membership_chains: child(),
  lodging_rating_categories: owner(),
  loyalty_memberships: owner(),
  // Owned chains travel; a catalogue chain a lodging names is resolved by name.
  lodging_chains: owner({ catalogue: { naturalKeys: [["name"]], where: "t0.user_id IS NULL" } }),
  // A package's price split is written after its members: inserting a member fires
  // `clear_package_split_on_membership`, which would mark a valid split stale.
  bookings: owner({ late: ["price_split"] }),
  companions: owner({ strip: ["linked_user_id"] }),
  trip_companions: child(),
  trip_stops: child({ strip: SHARE_KEY }),
  trip_routes: owner({ strip: SHARE_KEY }),
  trip_route_legs: child(),
  trip_route_tracks: child(),
  trip_expenses: owner(),
  trip_photos: child({
    files: [
      {
        column: "filename",
        dir: "trip-photos",
        kind: "name",
        mime: "mimetype",
        linkedWhen: ["immich_asset_id"],
      },
    ],
  }),
  trip_immich_albums: child(),
  trip_journal_entries: child(),
  journal_entry_photos: child(),
  trip_packing_lists: child(),
  trip_recording_batches: owner(),
  travel_plans: child({ rekey: ["create_ref"] }),
  travel_plan_proposals: child(),
  places: owner(),
  place_visits: owner(),
  place_visit_photos: child({
    files: [
      {
        column: "filename",
        dir: "place-photos",
        kind: "name",
        mime: "mimetype",
        linkedWhen: ["immich_asset_id", "trip_photo_id"],
      },
    ],
  }),
  place_categories: owner(),
  place_external_refs: owner(),
  place_captures: owner(),
  place_lists: owner(),
  place_list_entries: child(),
  // A smart list's chain rule: the account's own setting, keyed by the Wikidata brand id.
  place_list_brand_rules: owner(),
  notes: owner({
    files: [{ column: "photo_filename", dir: "note-photos", kind: "name", mime: "photo_mimetype" }],
  }),
  // Photos an entry links from Immich/PhotoPrism (links only, no bytes), and refusals.
  entry_photo_links: owner(),
  documents: owner({
    files: [
      {
        column: "stored_name",
        dir: "documents",
        kind: "name",
        mime: "mimetype",
        format: "format",
        sha256: "sha256",
        size: "size_bytes",
      },
    ],
    late: [
      "flight_id",
      "cruise_id",
      "lodging_stay_id",
      "trip_id",
      "place_visit_id",
      "rail_journey_id",
      "rental_booking_id",
      "bus_journey_id",
      "ferry_journey_id",
      "trip_expense_id",
      "rental_category",
    ],
  }),
  document_links: child(),
  receipt_uploads: owner({ files: [{ column: "filename", dir: "receipts", kind: "name" }] }),
  import_batches: owner(),
  parser_templates: owner(),
  country_days: owner(),
  country_overrides: owner(),
  photo_journeys: owner(),
  dawarich_stays: owner({ strip: ["claim_token", "evidence_key"] }),
  trip_suggestion_decisions: owner(),
  reminder_preferences: owner(),
  visit_photo_refusals: owner(),
  user_achievements: owner(),
  // `data.profile.profilePicture` names the avatar file.
  user_settings: owner({
    strip: USER_SETTINGS_SECRETS,
    files: [{ column: "data", dir: "profile-pictures", kind: "avatar" }],
  }),

  // TravTrack, the own location history.
  travtrack_points: owner({ bulk: true }),
  travtrack_point_links: owner({ bulk: true, idColumns: ["entry_id"] }),

  // The change history (spec 2026-11-22). Travels with the account; a row of an
  // entry the archive does not carry (a deleted one) names nothing on the target
  // and is skipped. The actor may be another account of this server, and a
  // restore's link to its source row is not re-keyed: both are cleared.
  change_ledger_entries: owner({
    idColumns: ["entity_id"],
    strip: ["actor_user_id", "restored_from_id"],
  }),
  travtrack_deleted_ranges: owner(),
  travtrack_privacy_zones: owner(),
  travtrack_gaps: owner(),
  travtrack_leg_modes: owner(),
  travtrack_stop_places: owner(),
  travtrack_stop_dismissals: owner(),
  travtrack_fixed_places: owner(),
  travtrack_place_settings: owner(),
  travtrack_zone_tombstones: owner(),
  reroute_runs: excluded(
    "Bulk re-routing progress of this server (forgejo#436): the cursor and counts describe a pass over this server's rows"
  ),
  travtrack_deleted_points: excluded(
    "a deleted point is kept as a digest keyed by the account id; it cannot be re-keyed without the position, which is not kept"
  ),

  // Catalogue rows an account's rows point at by numeric id.
  airports: {
    kind: "catalogue",
    spec: {
      naturalKeys: [
        ["iata", "is_closed"],
        ["icao", "is_closed"],
      ],
    },
  },
  ports: { kind: "catalogue", spec: { naturalKeys: [["unlocode"]] } },
  ships: { kind: "catalogue", spec: { naturalKeys: [["imo"]] } },
  rail_stations: { kind: "catalogue", spec: { naturalKeys: [["source_id"]] } },
  achievements: { kind: "catalogue", spec: { naturalKeys: [["code"]] } },
  airlines: excluded(CATALOGUE_UNREFERENCED),
  aircraft: excluded(CATALOGUE_UNREFERENCED),
  curated_lists: excluded(CATALOGUE_UNREFERENCED),
  curated_places: excluded(CATALOGUE_UNREFERENCED),
  lodging_chain_retired_names: excluded(CATALOGUE_UNREFERENCED),
  market_catalog_state: excluded(CATALOGUE_UNREFERENCED),
  market_catalog_tiles: excluded(CATALOGUE_UNREFERENCED),
  geo_city_cache: excluded("lookup cache, refilled on demand"),
  vessel_identities: excluded(
    "vessel resolver cache (name → MMSI), shared by the server, refilled on demand"
  ),

  // Shares and pairings: what the account shared, for the reader; never imported.
  public_share_links: { kind: "info", where: "t0.user_id = $1", omit: ["token_hash"] },
  share_consents: { kind: "info", where: "t0.requester_id = $1 OR t0.target_id = $1" },
  share_notices: { kind: "info", where: "t0.user_id = $1" },
  trip_share_groups: { kind: "info", where: "t0.created_by_id = $1" },
  remote_share_accounts: { kind: "info", where: "t0.user_id = $1", omit: ["claimed_code_hash"] },

  // Credentials.
  api_tokens: excluded(CREDENTIALS),
  calendar_feeds: excluded(CREDENTIALS),
  device_push: excluded(CREDENTIALS),
  push_deliveries: excluded(CREDENTIALS),
  pairing_codes: excluded(CREDENTIALS),
  password_reset_requests: excluded(CREDENTIALS),
  two_factor_recovery_codes: excluded(CREDENTIALS),
  webauthn_credentials: excluded(CREDENTIALS),
  travtrack_ingest_tokens: excluded(CREDENTIALS),
  invitations: excluded(CREDENTIALS),
  mail_intake_addresses: excluded(CREDENTIALS),
  mail_intake_sources: excluded(CREDENTIALS),
  user_webdav_syncs: excluded(CREDENTIALS),
  trip_share_invites: excluded(CREDENTIALS),
  comparison_invites: excluded(CREDENTIALS),
  leaderboard_invites: excluded(CREDENTIALS),
  revoked_sessions: excluded("session bookkeeping; sessions never move"),
  login_throttles: excluded("sign-in throttling of this server"),

  // Other accounts and federation.
  local_connections: excluded(OTHER_ACCOUNTS),
  leaderboard_consents: excluded(OTHER_ACCOUNTS),
  leaderboard_boards: excluded(OTHER_ACCOUNTS),
  leaderboard_board_members: excluded(OTHER_ACCOUNTS),
  leaderboard_remotes: excluded(FEDERATION),
  travel_plan_members: excluded(
    "who may work on a plan: access bookkeeping naming other accounts or servers"
  ),
  travel_plan_documents: excluded("documents shared into a plan by its members"),
  travel_plan_notices: excluded("notices addressed to plan members"),
  remote_plan_memberships: excluded(FEDERATION),
  connection_announcements: excluded(FEDERATION),
  federation_admission_requests: excluded(FEDERATION),
  trip_share_remote_members: excluded(FEDERATION),
  trip_share_outbox: excluded(FEDERATION),
  trip_share_inbound: excluded(FEDERATION),
  trip_share_peer_streams: excluded(FEDERATION),
  trip_share_entry_authors: excluded(FEDERATION),
  trip_share_roster_entries: excluded(FEDERATION),
  trip_share_roster_consents: excluded(FEDERATION),
  trip_share_withheld: excluded(FEDERATION),
  travtrack_share_snapshots: excluded("recipient-facing share snapshot, built again on request"),
  travtrack_share_past_flights: excluded("part of a share snapshot"),
  travtrack_share_past_homes: excluded("part of a share snapshot"),
  travtrack_share_past_spans: excluded("part of a share snapshot"),
  comparison_audit: excluded(FEDERATION),
  comparison_chunks: excluded(FEDERATION),
  comparison_circles: excluded(FEDERATION),
  comparison_devices: excluded(FEDERATION),
  comparison_grants: excluded(FEDERATION),
  comparison_links: excluded(FEDERATION),
  comparison_nonces: excluded(FEDERATION),
  comparison_peers: excluded(FEDERATION),
  comparison_publications: excluded(FEDERATION),
  merged_trip_redirects: excluded("routing aid for in-flight phone uploads; ids are re-keyed"),

  // Derived or bookkeeping.
  account_archive_imports: excluded("this server's record of archives it imported"),
  analytics_events: excluded("anonymous usage telemetry"),
  aeroapi_track_attempts: excluded(BOOKKEEPING),
  client_write_refs: excluded(BOOKKEEPING),
  data_quality_flags: excluded(DERIVED),
  dawarich_stay_scans: excluded(BOOKKEEPING),
  dawarich_sweep_state: excluded(BOOKKEEPING),
  document_link_passes: excluded(BOOKKEEPING),
  document_link_suggestions: excluded(DERIVED),
  // The user's dismissals are decisions, so they travel; entry_id names an entry without a foreign key.
  provenance_notices: owner({ idColumns: ["entry_id"] }),
  entry_photo_dirty: excluded(DERIVED),
  external_service_tests: excluded(BOOKKEEPING),
  ferry_route_backfills: excluded(BOOKKEEPING),
  immich_import_jobs: excluded(BOOKKEEPING),
  location_suggestions: excluded(DERIVED),
  mail_intake_messages: excluded(BOOKKEEPING),
  mail_intake_senders: excluded("mailbox configuration of this server's intake address"),
  packing_mutations: excluded(BOOKKEEPING),
  parse_training_logs: excluded("parser training log, operational"),
  training_data: excluded("parser training corpus, operational"),
  pending_flight_updates: excluded(BOOKKEEPING),
  pending_update_statistics: excluded(BOOKKEEPING),
  readiness_item_states: excluded("setup-check state tied to this server's revisions"),
  readiness_note_acks: excluded("read marks of this server's update notes"),
  reminder_claims: excluded(BOOKKEEPING),
  track_jitter_remeasures: excluded(BOOKKEEPING),
  travel_plan_mutations: excluded(BOOKKEEPING),
  travel_plan_usage: excluded(BOOKKEEPING),
  travtrack_dawarich_imports: excluded(BOOKKEEPING),
  travtrack_derivation_state: excluded(DERIVED),
  travtrack_diagnostic_events: excluded("14-day diagnostics log with its own export"),
  travtrack_diagnostic_uploads: excluded(BOOKKEEPING),
  travtrack_dirty_days: excluded(DERIVED),
  travtrack_explored_cells: excluded(DERIVED),
  travtrack_imports: excluded(BOOKKEEPING),
  travtrack_month_values: excluded(DERIVED),
  travtrack_uploads: excluded(BOOKKEEPING),
  travtrack_zone_cells: excluded(DERIVED),

  // Instance-wide.
  _poi_backfill_audit: excluded(INSTANCE),
  _prisma_migrations: excluded(INSTANCE),
  admin_settings: excluded(INSTANCE),
  aeroapi_usage: excluded(INSTANCE),
  airport_seeding_status: excluded(INSTANCE),
  backups: excluded(INSTANCE),
  instance_version_history: excluded(INSTANCE),
  smtp_config: excluded(INSTANCE),
  spatial_ref_sys: excluded(INSTANCE),
  sync_changes: excluded("the phones' change feed of this server"),
  sync_state: excluded(INSTANCE),
  time_migration_ledger: excluded(INSTANCE),
  travel_plan_config: excluded(INSTANCE),
  travtrack_config: excluded(INSTANCE),
};

export type DataPolicy = Extract<TablePolicy, { kind: "owner" | "child" }>;

export function isDataPolicy(policy: TablePolicy | undefined): policy is DataPolicy {
  return policy?.kind === "owner" || policy?.kind === "child";
}
