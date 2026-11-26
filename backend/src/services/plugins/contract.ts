/**
 * The suggestion plugin contract, version 1 (spec 2026-11-23-plugins-and-
 * calendar.md, Part B). The ONE definition: the client validates answers with
 * it, the OpenAPI document registers it as components, and the plugin
 * template's `contract/v1.schema.json` is exported from those components
 * (`scripts/export-plugin-contract.ts`), with a test that they are equal.
 *
 * Additive fields inside a major are allowed both ways and ignored when
 * unknown: the response objects are not strict. An unknown major is a
 * `protocol` failure.
 */
import { z } from "../../schemas/zod";

export const PLUGIN_CONTRACT_VERSION = 1;
export const MAX_SUGGESTIONS = 5;

const text = (max: number) => z.string().max(max);

export const pluginStopSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    timeZone: z.string().max(64),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    /** How far the coordinates were rounded before they left: 1, 100 or 1000. */
    precisionMeters: z.number().int().min(1),
    nearestPlace: z.object({ name: text(200), distanceMeters: z.number().int().min(0) }).optional(),
    venue: z.object({ name: text(200), category: text(64).optional() }).optional(),
    address: z
      .object({
        street: text(200).optional(),
        postcode: text(32).optional(),
        town: text(200).optional(),
        country: text(64).optional(),
      })
      .optional(),
  })
  .openapi("SuggestionPluginStopV1");

export const pluginRequestSchema = z
  .object({
    version: z.literal(PLUGIN_CONTRACT_VERSION),
    /** `test`: the settings page's test button, with a fixed synthetic stop. */
    kind: z.enum(["stop", "test"]),
    requestId: z.string().uuid(),
    stop: pluginStopSchema,
    locale: z.enum(["de", "en"]),
  })
  .openapi("SuggestionPluginRequestV1");
export type PluginRequest = z.infer<typeof pluginRequestSchema>;

/** At most this many extra columns a plugin-fed list shows. */
export const PLUGIN_LIST_MAX_COLUMNS = 6;
/** A column key: what `externalRef.fields` is keyed by. */
const columnKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/);
const bilingual = (max: number) =>
  z.object({ de: z.string().trim().min(1).max(max), en: z.string().trim().min(1).max(max) });

/**
 * Additive within v1: the plugin's own reference for a candidate, as an object. `id` is what
 * the plain-string form carried; `fields` fills the columns the hello announced (`list.columns`),
 * keys outside them are dropped by TravStats.
 */
export const pluginExternalRefSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    label: text(200).optional(),
    fields: z
      .record(columnKey, text(200))
      .refine((f) => Object.keys(f).length <= PLUGIN_LIST_MAX_COLUMNS, {
        message: `at most ${PLUGIN_LIST_MAX_COLUMNS} fields`,
      })
      .optional(),
  })
  .openapi("SuggestionPluginExternalRefV1");
export type PluginExternalRef = z.infer<typeof pluginExternalRefSchema>;

export const pluginSuggestionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: text(300).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    purpose: z.enum(["private", "business"]).optional(),
    note: text(500).optional(),
    /** A plain id, or (additive within v1) an object with a label and column fields. */
    externalRef: z.union([text(200), pluginExternalRefSchema]).optional(),
    /** Rendered as a plain link, never fetched by TravStats. */
    url: z
      .string()
      .max(2000)
      .url()
      .refine((u) => u.startsWith("https://"), { message: "https only" })
      .optional(),
    confidence: z.number().min(0).max(1),
    /**
     * Additive within v1: why the plugin names this candidate. `distance` = it lies
     * near the stop; `name` = a distinctive word of the stop's venue name matched,
     * further away (e.g. "MSA", 780 m) — shown as "Name passt (MSA), 780 m".
     */
    reason: z.enum(["distance", "name"]).optional(),
    distanceMeters: z.number().int().min(0).max(100_000).optional(),
    matchedToken: text(64).optional(),
    /** The plugin's own position for the candidate is only town-accurate. */
    lowPrecision: z.boolean().optional(),
  })
  .openapi("SuggestionPluginSuggestionV1");
export type PluginSuggestionWire = z.infer<typeof pluginSuggestionSchema>;

/**
 * A suggestion as TravStats keeps it: `externalRef` is always the plain id (what a finding's
 * evidence and an accepted place's `plugin:<pluginId>:<id>` reference compare), the object
 * form's label and fields ride beside it.
 */
export type PluginSuggestion = Omit<PluginSuggestionWire, "externalRef"> & {
  externalRef?: string;
  externalLabel?: string;
  externalFields?: Record<string, string>;
};

export function normalizeSuggestion(s: PluginSuggestionWire): PluginSuggestion {
  const { externalRef, ...rest } = s;
  if (externalRef === undefined || typeof externalRef === "string")
    return externalRef === undefined ? rest : { ...rest, externalRef };
  return {
    ...rest,
    externalRef: externalRef.id,
    ...(externalRef.label ? { externalLabel: externalRef.label } : {}),
    ...(externalRef.fields && Object.keys(externalRef.fields).length > 0
      ? { externalFields: externalRef.fields }
      : {}),
  };
}

export const pluginResponseSchema = z
  .object({
    version: z.number().int().min(1),
    suggestions: z.array(pluginSuggestionSchema).max(MAX_SUGGESTIONS),
    /**
     * Additive within v1: how far from the stop this plugin looked for `reason:
     * "name"` matches. Name suggestions are accepted up to this radius, capped
     * at 2 km; without it, and for every other suggestion, the 1 km limit holds.
     */
    nameRadiusMeters: z.number().int().min(0).max(100_000).optional(),
  })
  .openapi("SuggestionPluginResponseV1");

/** The optional signed `GET <url>`: who the plugin is and which kinds it answers. */
export const pluginHelloSchema = z
  .object({
    name: text(100),
    version: z.number().int().min(1),
    kinds: z.array(text(32)).max(10),
    /** Additive within v1: optional features, e.g. `maintenance` (location maintenance). */
    capabilities: z.array(text(32)).max(10).optional(),
    /**
     * Additive within v1: the plugin offers its places as a list. TravStats keeps one list per
     * registration (name editable), and shows `columns` filled from `externalRef.fields`.
     */
    list: z
      .object({
        defaultName: bilingual(100),
        columns: z
          .array(z.object({ key: columnKey, label: bilingual(40) }))
          .max(PLUGIN_LIST_MAX_COLUMNS)
          .refine((c) => new Set(c.map((x) => x.key)).size === c.length, {
            message: "column keys must be unique",
          })
          .default([]),
      })
      .optional(),
  })
  .openapi("SuggestionPluginHelloV1");
export type PluginHello = z.infer<typeof pluginHelloSchema>;

/*
 * Location maintenance (optional capability `maintenance`, owner 2026-11-24):
 * signed like every call, relative to the plugin's URL:
 *   POST maintenance/proposals  rows of the plugin's data without a usable
 *                               position, with proposals and their evidence
 *   POST maintenance/apply      write one confirmed position (the plugin's only write)
 *   POST maintenance/undo       restore the values before an apply
 *   POST maintenance/ignore     hide a row from the list (or show it again)
 * A plugin without the capability keeps working; TravStats only offers the
 * page when the hello names it.
 */
export const PLUGIN_CAPABILITY_MAINTENANCE = "maintenance";
export const MAINTENANCE_MAX_STOPS = 2000;
export const MAINTENANCE_MAX_ROWS = 300;
export const MAINTENANCE_MAX_QUERY = 100;

export const maintenanceStopSchema = z
  .object({
    venueName: text(200),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional(),
  })
  .openapi("PluginMaintenanceStopV1");

export const maintenanceProposalsRequestSchema = z
  .object({
    version: z.literal(PLUGIN_CONTRACT_VERSION),
    requestId: z.string().uuid(),
    locale: z.enum(["de", "en"]),
    /** Candidate stops (TravTrack, venue-named) the plugin may match; used for this answer only. */
    stops: z.array(maintenanceStopSchema).max(MAINTENANCE_MAX_STOPS),
    /** Additive: rows whose name, town, postcode, street or number contain every word. */
    query: z.string().max(MAINTENANCE_MAX_QUERY).optional(),
    /** Additive: paging over the plugin's sorted list. */
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(300).optional(),
  })
  .openapi("PluginMaintenanceProposalsRequestV1");

const level = z.enum(["high", "medium", "low"]);

export const maintenanceProposalSchema = z
  .object({
    source: z.enum(["stop", "geocoder"]),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    address: text(300).optional(),
    street: text(200).optional(),
    confidence: level,
    evidence: z
      .object({
        venueName: text(200).optional(),
        stopStart: z.string().max(40).nullable().optional(),
        stopEnd: z.string().max(40).nullable().optional(),
        query: text(300).optional(),
        label: text(200).optional(),
        precision: text(16).optional(),
        matchedTokens: z.array(text(64)).max(10).optional(),
        distanceMeters: z.number().int().min(0).optional(),
        agreesWithGeocoder: z.boolean().optional(),
        agreesWithStop: z.boolean().optional(),
      })
      .optional(),
  })
  .openapi("PluginMaintenanceProposalV1");
export type MaintenanceProposal = z.infer<typeof maintenanceProposalSchema>;

const rowId = z.union([z.string().min(1).max(64), z.number().int()]).transform(String);

const writtenSchema = z.object({
  Latitude: z.number().nullable().optional(),
  Longitude: z.number().nullable().optional(),
  Strasse: z.string().max(200).nullable().optional(),
  PLZ: z.string().max(32).nullable().optional(),
  Ort: z.string().max(200).nullable().optional(),
});

export const maintenanceRowSchema = z
  .object({
    rowId,
    projNr: text(64).nullable().optional(),
    name: text(200),
    street: text(200).nullable().optional(),
    postcode: text(32).nullable().optional(),
    town: text(200).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lon: z.number().min(-180).max(180).nullable().optional(),
    issues: z.array(z.enum(["noCoordinates", "noStreet", "lowPrecision", "coordsMismatch"])).max(4),
    ignored: z.boolean().optional(),
    proposals: z.array(maintenanceProposalSchema).max(10),
  })
  .openapi("PluginMaintenanceRowV1");

export const maintenanceAppliedSchema = z
  .object({
    undoId: text(64),
    rowId,
    name: text(200),
    written: writtenSchema,
    previous: writtenSchema.optional(),
    source: text(16),
    appliedAt: z.string().max(40),
  })
  .openapi("PluginMaintenanceAppliedV1");

/** What the plugin does not decide for the user: shown to them as plugin messages (owner 2026-11-26). */
export const maintenanceNoticeSchema = z
  .object({
    severity: z.enum(["info", "warning", "error"]),
    code: z.enum([
      "readOnly",
      "geocoderOff",
      "coordsMismatch",
      "ambiguousGeocoder",
      "severalStops",
    ]),
    rowId: rowId.optional(),
    name: text(200).optional(),
    message: text(300),
    count: z.number().int().min(0).optional(),
    distanceMeters: z.number().int().min(0).optional(),
    at: z.string().max(40).optional(),
  })
  .openapi("PluginMaintenanceNoticeV1");

export const maintenanceProposalsResponseSchema = z
  .object({
    version: z.number().int().min(1),
    rows: z.array(maintenanceRowSchema).max(MAINTENANCE_MAX_ROWS),
    totalRows: z.number().int().min(0).optional(),
    offset: z.number().int().min(0).optional(),
    applied: z.array(maintenanceAppliedSchema).max(200).optional(),
    /** Geocoder searches still running in the plugin; asking again later shows more. */
    pendingSearches: z.number().int().min(0).optional(),
    /** Uncertain cases, most severe first; independent of search and paging. */
    notices: z.array(maintenanceNoticeSchema).max(100).optional(),
    noticeCount: z.number().int().min(0).optional(),
    geocoder: z.boolean().optional(),
  })
  .openapi("PluginMaintenanceProposalsResponseV1");
export type MaintenanceProposals = z.infer<typeof maintenanceProposalsResponseSchema>;

export const MAINTENANCE_SOURCES = ["stop", "geocoder", "manual"] as const;

export const maintenanceApplyRequestSchema = z
  .object({
    version: z.literal(PLUGIN_CONTRACT_VERSION),
    requestId: z.string().uuid(),
    rowId: z.string().min(1).max(64),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    /** The values the user confirmed (editable before confirming); exactly these are written. */
    street: text(200).optional(),
    postcode: text(32).optional(),
    town: text(200).optional(),
    source: z.enum(MAINTENANCE_SOURCES),
    /** From `maintenance/confirm`: single use, bound to exactly these values. */
    token: text(200),
  })
  .openapi("PluginMaintenanceApplyRequestV1");

/** A ticket for one write, asked for when the user confirms in the dialog. Writes nothing. */
export const maintenanceConfirmRequestSchema = z
  .object({
    version: z.literal(PLUGIN_CONTRACT_VERSION),
    requestId: z.string().uuid(),
    kind: z.enum(["apply", "undo"]),
    rowId: z.string().min(1).max(64).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    street: text(200).optional(),
    postcode: text(32).optional(),
    town: text(200).optional(),
    undoId: text(64).optional(),
  })
  .openapi("PluginMaintenanceConfirmRequestV1");

export const maintenanceConfirmResponseSchema = z
  .object({ version: z.number().int().min(1), token: text(200), expiresAt: z.string().max(40) })
  .openapi("PluginMaintenanceConfirmResponseV1");

export const maintenanceApplyResponseSchema = z
  .object({ version: z.number().int().min(1), undoId: text(64), rowId, written: writtenSchema })
  .openapi("PluginMaintenanceApplyResponseV1");

export const maintenanceUndoRequestSchema = z
  .object({
    version: z.literal(PLUGIN_CONTRACT_VERSION),
    requestId: z.string().uuid(),
    undoId: text(64),
    token: text(200),
  })
  .openapi("PluginMaintenanceUndoRequestV1");

export const maintenanceUndoResponseSchema = z
  .object({ version: z.number().int().min(1), undoId: text(64), rowId, restored: writtenSchema })
  .openapi("PluginMaintenanceUndoResponseV1");

export const maintenanceIgnoreRequestSchema = z
  .object({
    version: z.literal(PLUGIN_CONTRACT_VERSION),
    requestId: z.string().uuid(),
    rowId: z.string().min(1).max(64),
    ignored: z.boolean(),
  })
  .openapi("PluginMaintenanceIgnoreRequestV1");

export const maintenanceIgnoreResponseSchema = z
  .object({ version: z.number().int().min(1), rowId, ignored: z.boolean() })
  .openapi("PluginMaintenanceIgnoreResponseV1");
