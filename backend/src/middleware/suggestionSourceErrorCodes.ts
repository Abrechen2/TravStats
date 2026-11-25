import type { CalendarFailureCode } from "../services/calendar/errors";

/**
 * Codes of the calendar source and the suggestion plugins (spec
 * 2026-11-23-plugins-and-calendar.md). Part of `ApiErrorCode`; the settings
 * page maps each to DE/EN copy.
 */
export type SuggestionSourceApiErrorCode =
  | CalendarFailureCode
  /** The account holds the most calendar sources it may (409). */
  | "CALENDAR_SOURCE_LIMIT"
  /** The account holds the most calendar rules it may (409). */
  | "CALENDAR_RULE_LIMIT"
  /** The account holds the most suggestion plugins it may (409). */
  | "PLUGIN_LIMIT"
  /** A plugin test or backfill failed; `error` carries the outcome kind (400). */
  | "PLUGIN_FAILED"
  /** A backfill for a plugin that does not allow it, or a range over 90 days (400). */
  | "PLUGIN_BACKFILL_REFUSED"
  /** A backfill of this plugin is already running (409). */
  | "PLUGIN_BACKFILL_RUNNING"
  /** The plugin does not announce location maintenance in its hello (409). */
  | "PLUGIN_NO_MAINTENANCE";
