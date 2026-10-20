import { z } from "zod";
import { prisma } from "../../db";

/**
 * The inbox suggestion switches (forgejo#306): whether this account is offered
 * trip suggestions and Dawarich stay suggestions at all.
 *
 * A switch that is off stops the WORK, not just the display: the trip engine
 * does not run and the stay scan neither reserves nor fetches a Dawarich point.
 * Hiding a tab while the server kept computing would have kept the cost and
 * the outbound calls the user just turned off.
 *
 * Nothing is deleted on the way out. `TripSuggestionDecision` rows, rejected
 * stays and accepted trips stay where they are, so switching back on resumes
 * from the decisions already made — a dismissed stay stays dismissed.
 *
 * Stored as flat columns on `UserSettings` (like `autoCreateTrips`); the API
 * nests them as `tripSuggestions.enabled` and `staySuggestions.*`, the shape
 * `autoUpdate` and `historicalEnrichment` already use.
 *
 * `tripRecording.enabled` (forgejo#316) rides along in the same plumbing: not
 * an inbox switch, but the same kind of thing — off stops the work (an upload
 * is refused, nothing stored) and keeps what is already there.
 */

export const tripSuggestionsSettingsSchema = z.object({ enabled: z.boolean() }).partial().strict();

export const staySuggestionsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /**
     * Immich photos as evidence for which place a stay was at, read by the
     * stay place identification of forgejo#305 (`dawarich/stays/identity.ts`).
     * It only ever applies where the account has an Immich connection.
     */
    immichEvidence: z.boolean(),
    /**
     * An LLM classifies a stay's place (forgejo#305, `dawarich/stays/placeType.ts`).
     * Off by default; a cloud provider additionally needs the instance's own
     * consent for that slot — this switch never stands in for it.
     */
    llmPlaceClassification: z.boolean(),
  })
  .partial()
  .strict();

export { tripRecordingSettingsSchema } from "../../schemas/tripRecording";
type TripRecordingPatch = { enabled?: boolean };
type TripSuggestionsPatch = z.infer<typeof tripSuggestionsSettingsSchema>;
type StaySuggestionsPatch = z.infer<typeof staySuggestionsSettingsSchema>;

/** The columns behind the switches, as Prisma selects them. */
export const SUGGESTION_SWITCH_SELECT = {
  tripSuggestionsEnabled: true,
  staySuggestionsEnabled: true,
  staySuggestionsImmichEvidence: true,
  staySuggestionsLlmPlaceClassification: true,
  tripRecordingEnabled: true,
} as const;

export interface SuggestionSwitchColumns {
  tripSuggestionsEnabled: boolean;
  staySuggestionsEnabled: boolean;
  staySuggestionsImmichEvidence: boolean;
  staySuggestionsLlmPlaceClassification: boolean;
  tripRecordingEnabled: boolean;
}

/** The column defaults — what an account without a settings row is answered with. */
export const SUGGESTION_SWITCH_DEFAULTS: SuggestionSwitchColumns = {
  tripSuggestionsEnabled: true,
  staySuggestionsEnabled: true,
  staySuggestionsImmichEvidence: true,
  staySuggestionsLlmPlaceClassification: false,
  tripRecordingEnabled: true,
};

export interface SuggestionSwitchesView {
  tripSuggestions: { enabled: boolean };
  staySuggestions: { enabled: boolean; immichEvidence: boolean; llmPlaceClassification: boolean };
  /** Whether the server stores the Companion's trip positions (forgejo#316). */
  tripRecording: { enabled: boolean };
}

export function suggestionSwitchesView(record: SuggestionSwitchColumns): SuggestionSwitchesView {
  return {
    tripSuggestions: { enabled: record.tripSuggestionsEnabled },
    staySuggestions: {
      enabled: record.staySuggestionsEnabled,
      immichEvidence: record.staySuggestionsImmichEvidence,
      llmPlaceClassification: record.staySuggestionsLlmPlaceClassification,
    },
    tripRecording: { enabled: record.tripRecordingEnabled },
  };
}

/** Only the keys a PUT named; an absent key leaves its column alone. */
export function suggestionSwitchesUpdate(
  trip: TripSuggestionsPatch | undefined,
  stay: StaySuggestionsPatch | undefined,
  recording?: TripRecordingPatch
): Partial<SuggestionSwitchColumns> {
  return {
    ...(recording?.enabled !== undefined ? { tripRecordingEnabled: recording.enabled } : {}),
    ...(trip?.enabled !== undefined ? { tripSuggestionsEnabled: trip.enabled } : {}),
    ...(stay?.enabled !== undefined ? { staySuggestionsEnabled: stay.enabled } : {}),
    ...(stay?.immichEvidence !== undefined
      ? { staySuggestionsImmichEvidence: stay.immichEvidence }
      : {}),
    ...(stay?.llmPlaceClassification !== undefined
      ? { staySuggestionsLlmPlaceClassification: stay.llmPlaceClassification }
      : {}),
  };
}

export async function readSuggestionSwitches(userId: string): Promise<SuggestionSwitchColumns> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: SUGGESTION_SWITCH_SELECT,
  });
  return row ?? SUGGESTION_SWITCH_DEFAULTS;
}

export async function tripSuggestionsEnabled(userId: string): Promise<boolean> {
  return (await readSuggestionSwitches(userId)).tripSuggestionsEnabled;
}

export async function staySuggestionsEnabled(userId: string): Promise<boolean> {
  return (await readSuggestionSwitches(userId)).staySuggestionsEnabled;
}

export async function tripRecordingEnabled(userId: string): Promise<boolean> {
  return (await readSuggestionSwitches(userId)).tripRecordingEnabled;
}
