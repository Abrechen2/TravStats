import { useRef, useState } from "react";
import type { JSX } from "react";
import Modal from "../../Modal";
import TagInput from "../../TagInput";
import CompanionPicker from "../../CompanionPicker";
import { FormErrorBanner, SaveBlockedHint, useDirtyGuard } from "../../form";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  BULK_EDIT_MAX_FLIGHTS,
  flightBulkEditApi,
  type FlightBulkEditResult,
  type ListEditMode,
} from "../../../lib/api/flightBulkEdit";
import { logger } from "../../../lib/logger";
import { isTransientSaveError, saveErrorKey } from "../../../lib/saveErrorMessage";
import type { Flight, Trip } from "../../../types";
import BulkEditPreviewText from "./BulkEditPreviewText";
import BulkEditResults from "./BulkEditResults";
import ModeChoice from "./ModeChoice";
import {
  bulkEditGaps,
  bulkEditPreview,
  bulkEditRequest,
  emptyBulkEditDraft,
  type BulkEditDraft,
  type ListEdit,
} from "./bulkEditModel";

const HINT_ID = "flight-bulk-edit-blocked";
const TRIP_SELECT_ID = "flight-bulk-trip";
/** The first "Reise" choice — where "nothing chosen yet" takes the cursor. */
const FIRST_CHOICE_ID = "flight-bulk-trip-first";
const TAGS_ID = "flight-bulk-tags";
const COMPANIONS_ID = "flight-bulk-companions";

type ListMode = "keep" | ListEditMode;

const listEdit = (mode: ListMode, values: string[]): ListEdit =>
  mode === "keep" ? { mode: "keep" } : { mode, values };

/**
 * Trip, tags and companions for an EXPLICIT selection of flights at once
 * (forgejo#217).
 *
 * Pattern: "disabled save + `SaveBlockedHint`" — the confirm button stays grey
 * until the draft asks for something, and says what is missing beside it.
 *
 * - Every field starts at "nicht ändern"; a field changes only when chosen.
 * - The preview says, before anything is sent, whether values are ADDED to
 *   what each flight has or REPLACE it, and for how many flights.
 * - The answer is per flight. Failures are listed by name; "erneut versuchen"
 *   sends only the flights the database refused — the server's modes are
 *   idempotent, so a flight that in fact went through answers `unchanged`.
 * - A changed draft asks before it is discarded (`useDirtyGuard`); once the
 *   edit was sent the guard is off, the result is what is on screen.
 */
export default function FlightBulkEditModal({
  flights,
  trips,
  labelOf,
  onClose,
  onApplied,
}: {
  flights: readonly Flight[];
  trips: readonly Trip[];
  labelOf: (flightId: string) => string;
  onClose: () => void;
  /** After any flight changed — the list reloads. */
  onApplied: () => void;
}): JSX.Element {
  const { t } = useTranslation(["flights", "common", "trips"]);
  const [draft, setDraft] = useState<BulkEditDraft>(emptyBulkEditDraft);
  const [tagValues, setTagValues] = useState<string[]>([]);
  const [companionValues, setCompanionValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [results, setResults] = useState<Map<string, FlightBulkEditResult> | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const { dirty } = useDirtyGuard(
    { draft: emptyBulkEditDraft(), tagValues: [], companionValues: [] },
    { draft, tagValues, companionValues }
  );

  // The two inputs hold their chips apart from the mode, so switching the
  // mode keeps what was typed; the draft reads them here.
  const effective: BulkEditDraft = {
    ...draft,
    tags: listEdit(draft.tags.mode, tagValues),
    companions: listEdit(draft.companions.mode, companionValues),
  };
  const preview = bulkEditPreview(effective, flights, trips);
  const gaps = bulkEditGaps(effective);
  const missing = gaps.map((gap) => ({
    field:
      gap === "trip"
        ? TRIP_SELECT_ID
        : gap === "tags"
          ? TAGS_ID
          : gap === "companions"
            ? COMPANIONS_ID
            : FIRST_CHOICE_ID,
    label: t(`flights:bulk.missing.${gap}`),
  }));
  // The server takes at most 200 at once; more is said here, not answered
  // with a validation sentence about fields nobody marked (review I2).
  if (flights.length > BULK_EDIT_MAX_FLIGHTS) {
    missing.unshift({
      field: FIRST_CHOICE_ID,
      label: t("flights:bulk.missing.tooMany", {
        max: BULK_EDIT_MAX_FLIGHTS,
        count: flights.length,
      }),
    });
  }
  // The ids of the last request — what a retry after a failed REQUEST sends again.
  const lastSent = useRef<string[]>([]);

  const send = async (flightIds: string[]): Promise<void> => {
    if (inFlight.current || flightIds.length === 0) return;
    inFlight.current = true;
    lastSent.current = flightIds;
    setSending(true);
    setRequestError(null);
    try {
      const answer = await flightBulkEditApi.edit(bulkEditRequest(effective, flightIds));
      setResults((prev) => {
        const next = new Map(prev ?? []);
        for (const r of answer.results) next.set(r.flightId, r);
        return next;
      });
      if (answer.summary.updated > 0) onApplied();
    } catch (err: unknown) {
      logger.warn({ err }, "FlightBulkEditModal: bulk edit failed");
      // No answer, or a server error: some flights may have changed before it
      // broke off — say the outcome is unknown, never "nothing changed". A
      // retry is safe (every mode is idempotent) and a reload shows the truth.
      const status = (err as { response?: { status?: number } } | null)?.response?.status;
      setRequestError(
        status !== undefined && status < 500
          ? saveErrorKey(err, "flights:bulk.requestFailed")
          : "flights:bulk.outcomeUnknown"
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const retryable = results
    ? [...results.values()]
        .filter((r) => r.status === "failed" && r.code === "UPDATE_FAILED")
        .map((r) => r.flightId)
    : [];
  const sendAll = (): void => void send(flights.map((f) => f.id));
  const outcomeUnknown = requestError === "flights:bulk.outcomeUnknown";
  // Shown in BOTH views: a failed "retry the failed ones" lands in the results
  // view, where it used to say nothing (review I3).
  const requestFailure = (
    <>
      <FormErrorBanner
        message={requestError ? t(requestError) : null}
        onRetry={
          requestError && (outcomeUnknown || isTransientSaveError(requestError))
            ? () => void send(lastSent.current)
            : undefined
        }
        retryDisabled={sending}
      />
      {outcomeUnknown ? (
        <button
          type="button"
          className="btn-secondary self-start pointer-coarse:min-h-(--ts-size-touch-min)"
          onClick={onApplied}
        >
          {t("flights:bulk.reloadList")}
        </button>
      ) : null}
    </>
  );
  const button = "btn-primary";
  const secondary = "btn-secondary";

  return (
    <Modal
      open
      onClose={onClose}
      busy={sending}
      dirty={dirty && results === null}
      closeLabel={t("common:buttons.close")}
      title={t("flights:bulk.title", { count: flights.length })}
      testId="flight-bulk-edit"
      footer={(requestClose) =>
        results !== null ? (
          <>
            {retryable.length > 0 ? (
              <button
                type="button"
                className={secondary}
                disabled={sending}
                onClick={() => void send(retryable)}
              >
                {t("flights:bulk.result.retryFailed", { count: retryable.length })}
              </button>
            ) : null}
            <button type="button" className={button} onClick={onClose} disabled={sending}>
              {t("common:buttons.close")}
            </button>
          </>
        ) : (
          <>
            <div className="mr-auto self-center">
              <SaveBlockedHint id={HINT_ID} missing={missing} />
            </div>
            <button type="button" className={secondary} onClick={requestClose} disabled={sending}>
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              className={button}
              onClick={sendAll}
              disabled={sending || missing.length > 0}
              aria-describedby={HINT_ID}
            >
              {sending
                ? t("common:buttons.saving")
                : t("flights:bulk.confirm", { count: flights.length })}
            </button>
          </>
        )
      }
    >
      {results !== null ? (
        <div className="flex flex-col" style={{ gap: 12 }}>
          <BulkEditResults results={results} labelOf={labelOf} />
          {requestFailure}
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 16 }}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("flights:bulk.intro", { count: flights.length })}
          </p>
          <div className="flex flex-col" style={{ gap: 6 }}>
            <ModeChoice
              name="bulk-trip"
              firstId={FIRST_CHOICE_ID}
              legend={t("flights:bulk.trip")}
              value={draft.trip.mode}
              options={[
                { value: "keep", label: t("flights:bulk.keep") },
                { value: "set", label: t("flights:bulk.tripSet") },
                { value: "clear", label: t("flights:bulk.tripClear") },
              ]}
              onChange={(mode) =>
                setDraft((d) => ({
                  ...d,
                  trip: mode === "set" ? { mode, tripId: "" } : { mode },
                }))
              }
            />
            {draft.trip.mode === "set" ? (
              <label className="flex flex-col text-sm" style={{ gap: 4 }} htmlFor={TRIP_SELECT_ID}>
                {t("flights:bulk.tripPick")}
                <select
                  id={TRIP_SELECT_ID}
                  className="input pointer-coarse:min-h-(--ts-size-touch-min)"
                  value={draft.trip.tripId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, trip: { mode: "set", tripId: e.target.value } }))
                  }
                >
                  <option value="">{t("flights:bulk.tripPickPlaceholder")}</option>
                  {trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="flex flex-col" style={{ gap: 6 }}>
            <ModeChoice<ListMode>
              name="bulk-tags"
              legend={t("flights:bulk.tags")}
              value={draft.tags.mode}
              options={[
                { value: "keep", label: t("flights:bulk.keep") },
                { value: "add", label: t("flights:bulk.add") },
                { value: "replace", label: t("flights:bulk.replace") },
              ]}
              onChange={(mode) => setDraft((d) => ({ ...d, tags: listEdit(mode, []) }))}
            />
            {draft.tags.mode !== "keep" ? (
              <TagInput
                id={TAGS_ID}
                value={tagValues}
                onChange={setTagValues}
                ariaLabel={t("flights:bulk.tags")}
              />
            ) : null}
          </div>
          <div className="flex flex-col" style={{ gap: 6 }}>
            <ModeChoice<ListMode>
              name="bulk-companions"
              legend={t("flights:bulk.companions")}
              value={draft.companions.mode}
              options={[
                { value: "keep", label: t("flights:bulk.keep") },
                { value: "add", label: t("flights:bulk.add") },
                { value: "replace", label: t("flights:bulk.replace") },
              ]}
              onChange={(mode) => setDraft((d) => ({ ...d, companions: listEdit(mode, []) }))}
            />
            {draft.companions.mode !== "keep" ? (
              <div id={COMPANIONS_ID} tabIndex={-1}>
                <CompanionPicker value={companionValues} onChange={setCompanionValues} />
              </div>
            ) : null}
          </div>
          <BulkEditPreviewText preview={preview} />
          {requestFailure}
        </div>
      )}
    </Modal>
  );
}
