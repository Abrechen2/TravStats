import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import TagInput from "../TagInput";
import CompanionPicker from "../CompanionPicker";
import { FormErrorBanner, SaveBlockedHint, useDirtyGuard } from "../form";
import ModeChoice from "../flightsTable/bulk/ModeChoice";
import { useTranslation } from "../../hooks/useTranslation";
import { domainBulkEditApi, type DomainBulkEditResult } from "../../lib/api/domainBulkEdit";
import { tripsApi } from "../../lib/api/trips";
import { logger } from "../../lib/logger";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import { RAIL_TRAVEL_CLASSES } from "../../types/rail";
import {
  BULK_FIELDS,
  DOMAIN_BULK_MAX,
  type BulkDomain,
  type BulkField,
} from "../../shared/bulkEditFields";
import type { Trip } from "../../types";
import BulkEditPreviewText from "./BulkEditPreviewText";
import BulkEditResults from "./BulkEditResults";
import {
  bulkEditGaps,
  bulkEditPreview,
  bulkEditRequest,
  emptyBulkEditDraft,
  type BulkEditDraft,
  type ListEdit,
  type TextEditDraft,
} from "./bulkEditModel";
import type { BulkRow } from "./useRowSelection";

type ListMode = "keep" | "add" | "replace";
type TextMode = "keep" | "set" | "clear";

const ID = (field: string): string => `bulk-edit-${field}`;
const listEdit = (mode: ListMode, values: string[]): ListEdit =>
  mode === "keep" ? { mode: "keep" } : { mode, values };
const textEdit = (mode: TextMode, value: string): TextEditDraft =>
  mode === "set" ? { mode, value } : { mode };

/**
 * Trip, tags, companions, status and — for rides — operator and class, over an
 * EXPLICIT selection (forgejo#405 A4; the flights modal of forgejo#217 on one
 * pattern for every domain). The domain decides which fields it offers
 * (`shared/bulkEditFields.ts`, the same list the server accepts).
 *
 * - Every field starts at "nicht ändern"; a field changes only when chosen.
 * - The preview says, before anything is sent, what is ADDED, what REPLACED,
 *   and for how many of the selected rows.
 * - The answer is per row. Failures are listed by name; "erneut versuchen"
 *   sends only the rows the database refused (every mode is idempotent). A row
 *   that moved on elsewhere answers VERSION_CONFLICT and is never overwritten.
 */
export default function DomainBulkEditModal({
  domain,
  rows,
  onClose,
  onApplied,
}: {
  domain: BulkDomain;
  rows: readonly BulkRow[];
  onClose: () => void;
  /** After any row changed — the list reloads. */
  onApplied: () => void;
}): JSX.Element {
  const { t } = useTranslation(["bulkEdit", "common", "rail"]);
  const fields = BULK_FIELDS[domain];
  const offers = (f: BulkField): boolean => fields.includes(f);
  const [draft, setDraft] = useState<BulkEditDraft>(emptyBulkEditDraft);
  const [tagValues, setTagValues] = useState<string[]>([]);
  const [companionValues, setCompanionValues] = useState<string[]>([]);
  const [trips, setTrips] = useState<readonly Trip[]>([]);
  const [tripsFailed, setTripsFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [results, setResults] = useState<Map<string, DomainBulkEditResult> | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const lastSent = useRef<string[]>([]);
  const { dirty } = useDirtyGuard(
    { draft: emptyBulkEditDraft(), tagValues: [], companionValues: [] },
    { draft, tagValues, companionValues }
  );

  const [tripsToken, setTripsToken] = useState(0);
  useEffect(() => {
    if (!offers("trip")) return;
    let cancelled = false;
    setTripsFailed(false);
    tripsApi
      .getAll()
      .then((list) => {
        if (!cancelled) setTrips(list);
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "DomainBulkEditModal: trips did not load");
        if (!cancelled) setTripsFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `offers` is derived from `domain`
  }, [domain, tripsToken]);

  // The inputs hold their chips apart from the mode, so switching the mode keeps what was typed.
  const effective: BulkEditDraft = {
    ...draft,
    tags: listEdit(draft.tags.mode, tagValues),
    companions: listEdit(draft.companions.mode, companionValues),
  };
  const preview = bulkEditPreview(effective, rows);
  const tripChoice = effective.trip;
  const tripName =
    tripChoice.mode === "set" ? (trips.find((x) => x.id === tripChoice.tripId)?.name ?? "") : "";
  const gaps = bulkEditGaps(effective, fields);
  const missing = gaps.map((gap) => ({
    field: gap === "nothing" ? ID("first") : ID(gap),
    label: t(`bulkEdit:missing.${gap}`),
  }));
  if (rows.length > DOMAIN_BULK_MAX) {
    missing.unshift({
      field: ID("first"),
      label: t("bulkEdit:missing.tooMany", { max: DOMAIN_BULK_MAX, count: rows.length }),
    });
  }
  const labelOf = (id: string): string => rows.find((r) => r.id === id)?.label ?? id;

  const send = async (only: string[]): Promise<void> => {
    if (inFlight.current || only.length === 0) return;
    inFlight.current = true;
    lastSent.current = only;
    setSending(true);
    setRequestError(null);
    try {
      const chosen = rows.filter((r) => only.includes(r.id));
      const answer = await domainBulkEditApi.edit(
        domain,
        bulkEditRequest(effective, fields, chosen)
      );
      setResults((prev) => {
        const next = new Map(prev ?? []);
        for (const r of answer.results) next.set(r.id, r);
        return next;
      });
      if (answer.summary.updated > 0) onApplied();
    } catch (err: unknown) {
      logger.warn({ err }, "DomainBulkEditModal: bulk edit failed");
      // No answer, or a server error: some rows may have changed before it broke
      // off — say the outcome is unknown, never "nothing changed". A retry is
      // safe (every mode is idempotent) and a reload shows the truth.
      const status = (err as { response?: { status?: number } } | null)?.response?.status;
      setRequestError(
        status !== undefined && status < 500
          ? saveErrorKey(err, "bulkEdit:requestFailed")
          : "bulkEdit:outcomeUnknown"
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const failed = results ? [...results.values()].filter((r) => r.status === "failed") : [];
  const retryable = failed.filter((r) => r.code === "UPDATE_FAILED").map((r) => r.id);
  const moved = failed.some((r) => r.code === "VERSION_CONFLICT");
  const outcomeUnknown = requestError === "bulkEdit:outcomeUnknown";
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
      {outcomeUnknown || moved ? (
        <button
          type="button"
          className="btn-secondary self-start pointer-coarse:min-h-(--ts-size-touch-min)"
          onClick={onApplied}
        >
          {t("bulkEdit:reloadList")}
        </button>
      ) : null}
    </>
  );
  const noun = t(`bulkEdit:noun.${domain}`, { count: rows.length });
  const modes = (names: ReadonlyArray<ListMode>): Array<{ value: ListMode; label: string }> =>
    names.map((value) => ({ value, label: t(`bulkEdit:mode.${value}`) }));

  return (
    <Modal
      open
      onClose={onClose}
      busy={sending}
      dirty={dirty && results === null}
      closeLabel={t("common:buttons.close")}
      title={t("bulkEdit:title", { count: rows.length, noun })}
      testId="domain-bulk-edit"
      footer={(requestClose) =>
        results !== null ? (
          <>
            {retryable.length > 0 ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={sending}
                onClick={() => void send(retryable)}
              >
                {t("bulkEdit:result.retryFailed", { count: retryable.length })}
              </button>
            ) : null}
            <button type="button" className="btn-primary" onClick={onClose} disabled={sending}>
              {t("common:buttons.close")}
            </button>
          </>
        ) : (
          <>
            <div className="mr-auto self-center">
              <SaveBlockedHint id="bulk-edit-blocked" missing={missing} />
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={requestClose}
              disabled={sending}
            >
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void send(rows.map((r) => r.id))}
              disabled={sending || missing.length > 0}
              aria-describedby="bulk-edit-blocked"
            >
              {sending
                ? t("common:buttons.saving")
                : t("bulkEdit:confirm", { count: rows.length, noun })}
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
            {t("bulkEdit:intro", { count: rows.length, noun })}
          </p>
          {offers("trip") ? (
            <div className="flex flex-col" style={{ gap: 6 }}>
              <ModeChoice
                name="bulk-trip"
                firstId={ID("first")}
                legend={t("bulkEdit:field.trip")}
                value={draft.trip.mode}
                options={[
                  { value: "keep", label: t("bulkEdit:mode.keep") },
                  { value: "set", label: t("bulkEdit:mode.tripSet") },
                  { value: "clear", label: t("bulkEdit:mode.tripClear") },
                ]}
                onChange={(mode) =>
                  setDraft((d) => ({
                    ...d,
                    trip: mode === "set" ? { mode, tripId: "" } : { mode },
                  }))
                }
              />
              {draft.trip.mode === "set" ? (
                <label className="flex flex-col text-sm" style={{ gap: 4 }} htmlFor={ID("trip")}>
                  {t("bulkEdit:tripPick")}
                  <select
                    id={ID("trip")}
                    className="input pointer-coarse:min-h-(--ts-size-touch-min)"
                    value={draft.trip.tripId}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, trip: { mode: "set", tripId: e.target.value } }))
                    }
                  >
                    <option value="">{t("bulkEdit:tripPickPlaceholder")}</option>
                    {trips.map((trip) => (
                      <option key={trip.id} value={trip.id}>
                        {trip.name}
                      </option>
                    ))}
                  </select>
                  {tripsFailed ? (
                    <span role="alert" style={{ color: "var(--danger)" }}>
                      {t("bulkEdit:tripsFailed")}{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setTripsToken((n) => n + 1)}
                      >
                        {t("common:buttons.retry")}
                      </button>
                    </span>
                  ) : null}
                </label>
              ) : null}
            </div>
          ) : null}
          {offers("tags") ? (
            <div className="flex flex-col" style={{ gap: 6 }}>
              <ModeChoice<ListMode>
                name="bulk-tags"
                legend={t("bulkEdit:field.tags")}
                value={draft.tags.mode}
                options={modes(["keep", "add", "replace"])}
                onChange={(mode) => setDraft((d) => ({ ...d, tags: listEdit(mode, []) }))}
              />
              {draft.tags.mode !== "keep" ? (
                <TagInput
                  id={ID("tags")}
                  value={tagValues}
                  onChange={setTagValues}
                  ariaLabel={t("bulkEdit:field.tags")}
                />
              ) : null}
            </div>
          ) : null}
          {offers("companions") ? (
            <div className="flex flex-col" style={{ gap: 6 }}>
              <ModeChoice<ListMode>
                name="bulk-companions"
                legend={t("bulkEdit:field.companions")}
                value={draft.companions.mode}
                options={modes(["keep", "add", "replace"])}
                onChange={(mode) => setDraft((d) => ({ ...d, companions: listEdit(mode, []) }))}
              />
              {draft.companions.mode !== "keep" ? (
                <div id={ID("companions")} tabIndex={-1}>
                  <CompanionPicker value={companionValues} onChange={setCompanionValues} />
                </div>
              ) : null}
            </div>
          ) : null}
          {offers("status") ? (
            <ModeChoice<"keep" | "cancel" | "reinstate">
              name="bulk-status"
              legend={t("bulkEdit:field.status")}
              value={draft.status.mode}
              options={[
                { value: "keep", label: t("bulkEdit:mode.keep") },
                { value: "cancel", label: t("bulkEdit:mode.statusCancel") },
                { value: "reinstate", label: t("bulkEdit:mode.statusReinstate") },
              ]}
              onChange={(mode) => setDraft((d) => ({ ...d, status: { mode } }))}
            />
          ) : null}
          {(["operator", "serviceClass"] as const).map((field) =>
            offers(field) ? (
              <div key={field} className="flex flex-col" style={{ gap: 6 }}>
                <ModeChoice<TextMode>
                  name={`bulk-${field}`}
                  legend={t(`bulkEdit:field.${field}`)}
                  value={draft[field].mode}
                  options={[
                    { value: "keep", label: t("bulkEdit:mode.keep") },
                    { value: "set", label: t("bulkEdit:mode.textSet") },
                    { value: "clear", label: t("bulkEdit:mode.textClear") },
                  ]}
                  onChange={(mode) => setDraft((d) => ({ ...d, [field]: textEdit(mode, "") }))}
                />
                {draft[field].mode === "set" ? (
                  <TextValue
                    id={ID(field)}
                    label={t(`bulkEdit:field.${field}`)}
                    rail={domain === "rail" && field === "serviceClass"}
                    value={(draft[field] as { value: string }).value}
                    onChange={(value) =>
                      setDraft((d) => ({ ...d, [field]: { mode: "set", value } }))
                    }
                  />
                ) : null}
              </div>
            ) : null
          )}
          <BulkEditPreviewText domain={domain} preview={preview} tripName={tripName} />
          {requestFailure}
        </div>
      )}
    </Modal>
  );
}

/** A free-text value, or — for a train's class — the closed list the server accepts. */
function TextValue({
  id,
  label,
  rail,
  value,
  onChange,
}: {
  id: string;
  label: string;
  rail: boolean;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["bulkEdit", "rail"]);
  return rail ? (
    <select
      id={id}
      aria-label={label}
      className="input pointer-coarse:min-h-(--ts-size-touch-min)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t("bulkEdit:tripPickPlaceholder")}</option>
      {RAIL_TRAVEL_CLASSES.map((c) => (
        <option key={c} value={c}>
          {t(`rail:class.${c}`)}
        </option>
      ))}
    </select>
  ) : (
    <input
      id={id}
      type="text"
      aria-label={label}
      maxLength={100}
      className="input pointer-coarse:min-h-(--ts-size-touch-min)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
