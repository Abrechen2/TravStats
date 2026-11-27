import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { shareLinksApi } from "../../lib/api/shareLinks";
import { useDisplayFormat } from "../../lib/format";
import { logger } from "../../lib/logger";
import { apiErrorMachineCode } from "../../lib/apiError";
import {
  SHARE_LINK_DEFAULT_FIELDS,
  SHARE_LINK_FIELDS,
  SHARE_LINK_ITINERARY_SECTIONS,
  type CreatableShareLinkKind,
  type CreatedShareLink,
  type PhotoOmissions,
  type ShareLinkPreviewResult,
} from "../../types/shareLinks";
import Dialog from "../ui/Dialog";
import Button from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";
import { EXPIRY_CHOICES, shareLinkErrorKey, type ExpiryChoice } from "./shareLinkCopy";
import ShareLinkPreview from "./ShareLinkPreview";
import InlineError from "../ui/InlineError";

const NS = "sharing:links";

type Status = "loading" | "enabled" | "disabled" | "failed";

const SECTIONS: readonly string[] = SHARE_LINK_ITINERARY_SECTIONS;

/**
 * The checkboxes outside the itinerary, in the order the page shows them.
 * `itinerary` — the old "every section" field — is not offered: the sections are.
 */
function plainFields(kind: CreatableShareLinkKind): string[] {
  return SHARE_LINK_FIELDS[kind].filter((f) => f !== "itinerary" && !SECTIONS.includes(f));
}

/**
 * "Als Link teilen" (forgejo#281): pick what a public page shows, see exactly
 * that in the preview, choose how long it lives, create it — and copy the URL,
 * which is shown this once (the server keeps only its hash).
 *
 * The preview is the server's own serializer, asked with the current choice,
 * so it cannot claim less than the link will show. While the instance switch
 * is off the dialog says so instead of offering a form that can only fail.
 *
 * A trip link is the family itinerary (owner, 2026-11-22): flights, stays and
 * transport are on by default, places are opt-in, and the link lives until a
 * week after the trip unless the owner picks a shorter time.
 */
export default function ShareLinkDialog({
  open,
  onClose,
  kind,
  targetId,
}: {
  open: boolean;
  onClose: () => void;
  kind: CreatableShareLinkKind;
  targetId: string;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const format = useDisplayFormat();
  const [status, setStatus] = useState<Status>("loading");
  const [fields, setFields] = useState<string[]>([...SHARE_LINK_DEFAULT_FIELDS[kind]]);
  const [expiry, setExpiry] = useState<ExpiryChoice>(kind === "trip" ? "tripEnd" : "week");
  const [preview, setPreview] = useState<ShareLinkPreviewResult | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [created, setCreated] = useState<CreatedShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tripEnded, setTripEnded] = useState(false);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setStatus("loading");
    shareLinksApi
      .list()
      .then((list) => alive && setStatus(list.enabled ? "enabled" : "disabled"))
      .catch((err: unknown) => {
        logger.error("Loading the share-link status failed:", err);
        if (alive) setStatus("failed");
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const selectionKey = useMemo(() => [...fields].sort().join(","), [fields]);

  useEffect(() => {
    if (!open || status !== "enabled" || fields.length === 0 || created) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreviewFailed(false);
    shareLinksApi
      .preview({ kind, targetId, fields })
      .then((result) => alive && setPreview(result))
      .catch((err: unknown) => {
        logger.error("Share-link preview failed:", err);
        if (alive) {
          setPreview(null);
          setPreviewFailed(true);
        }
      });
    return () => {
      alive = false;
    };
    // `selectionKey` stands for `fields`: a new array with the same members is no new question.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectionKey stands for fields (see above)
  }, [open, status, kind, targetId, selectionKey, created]);

  const toggle = (field: string, on: boolean): void => {
    setTripEnded(false);
    setFields((current) => (on ? [...current, field] : current.filter((f) => f !== field)));
  };

  const create = async (
    choice: { fields?: string[]; afterTripEnd?: boolean } = {}
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    setTripEnded(false);
    const sent = choice.fields ?? fields;
    try {
      const withItinerary = kind === "trip" && sent.some((f) => SECTIONS.includes(f));
      const expiresInDays = EXPIRY_CHOICES[withItinerary ? shownExpiry : nonTripEndExpiry];
      setCreated(
        await shareLinksApi.create({
          kind,
          targetId,
          fields: sent,
          expiresInDays,
          ...(choice.afterTripEnd ? { afterTripEnd: true } : {}),
        })
      );
      if (choice.fields) setFields(choice.fields);
    } catch (err) {
      logger.error("Creating a share link failed:", err);
      // An ended trip is not a dead end (UAT rc.45 M2): the dialog offers the
      // itinerary for a week from now, or the trip as a recap without it.
      setTripEnded(apiErrorMachineCode(err) === "SHARE_LINK_TRIP_ENDED");
      setError(t(shareLinkErrorKey(err, `${NS}.errors.createFailed`)));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!created) return;
    try {
      // navigator.clipboard needs a secure context; plain-http LAN has none.
      if (!window.isSecureContext || !navigator.clipboard?.writeText)
        throw new Error("no clipboard");
      await navigator.clipboard.writeText(created.url);
      setCopied("yes");
    } catch (err) {
      logger.warn("Copying the share link failed:", err);
      setCopied("failed");
    }
  };

  const close = (): void => {
    setCreated(null);
    setCopied(null);
    setError(null);
    setTripEnded(false);
    onClose();
  };

  // "Until a week after the trip" holds only while an itinerary is shown: the server's
  // trip-end cap applies to itinerary links alone, so without one it would mean 90 days.
  const hasItinerary = kind === "trip" && fields.some((f) => SECTIONS.includes(f));
  const shownExpiry: ExpiryChoice = expiry === "tripEnd" && !hasItinerary ? "week" : expiry;
  const nonTripEndExpiry: ExpiryChoice = expiry === "tripEnd" ? "week" : expiry;
  const recapFields = fields.filter((f) => !SECTIONS.includes(f));
  const choices = (Object.keys(EXPIRY_CHOICES) as ExpiryChoice[]).filter(
    (choice) => hasItinerary || choice !== "tripEnd"
  );
  const checkbox = (field: string, describedBy?: string): JSX.Element => (
    <label key={field} className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={fields.includes(field)}
        onChange={(e) => toggle(field, e.target.checked)}
        aria-describedby={describedBy}
      />
      {t(`${NS}.fields.${kind}.${field}`)}
    </label>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t(`${NS}.dialog.title`)}
      busy={busy}
      maxWidth={560}
      footer={
        status === "enabled" && !created ? (
          <div className="flex w-full flex-col gap-2">
            {/* In the footer, not under the preview: a long itinerary pushed the
                reason out of sight and the dialog seemed to do nothing (M2). */}
            {error && <InlineError>{error}</InlineError>}
            <div className="flex flex-wrap justify-end gap-2">
              {tripEnded && (
                <>
                  <Button disabled={busy} onClick={() => void create({ afterTripEnd: true })}>
                    {t(`${NS}.dialog.tripEndedWeek`)}
                  </Button>
                  {recapFields.length > 0 && (
                    <Button disabled={busy} onClick={() => void create({ fields: recapFields })}>
                      {t(`${NS}.dialog.tripEndedRecap`)}
                    </Button>
                  )}
                </>
              )}
              {!tripEnded && (
                <Button
                  variant="primary"
                  disabled={busy || fields.length === 0}
                  onClick={() => void create()}
                >
                  {t(`${NS}.dialog.create`)}
                </Button>
              )}
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {status === "disabled" && <p role="status">{t(`${NS}.dialog.disabled`)}</p>}
        {status === "failed" && <InlineError>{t(`${NS}.dialog.statusFailed`)}</InlineError>}
        {status === "enabled" && created && (
          <>
            <p role="status">{t(`${NS}.dialog.created`)}</p>
            <Field label={t(`${NS}.dialog.linkLabel`)} htmlFor="share-link-url">
              <Input
                id="share-link-url"
                readOnly
                value={created.url}
                onFocus={(e) => e.currentTarget.select()}
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button onClick={() => void copy()}>{t(`${NS}.dialog.copy`)}</Button>
              {copied === "yes" && <span role="status">{t(`${NS}.dialog.copied`)}</span>}
              {copied === "failed" && <InlineError>{t(`${NS}.dialog.copyFailed`)}</InlineError>}
            </div>
            <p className="t-caption">
              {t(`${NS}.dialog.endsAt`, { date: format.dateTime(created.effectiveExpiresAt) })}
            </p>
          </>
        )}
        {status === "enabled" && !created && (
          <>
            <p className="t-caption">{t(`${NS}.dialog.warning`)}</p>
            {kind === "trip" && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 font-semibold">{t(`${NS}.dialog.itineraryTitle`)}</legend>
                <p id="share-link-itinerary-hint" className="t-caption">
                  {t(`${NS}.dialog.itineraryHint`)}
                </p>
                {SHARE_LINK_ITINERARY_SECTIONS.map((field) =>
                  checkbox(field, "share-link-itinerary-hint")
                )}
              </fieldset>
            )}
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 font-semibold">{t(`${NS}.dialog.fieldsTitle`)}</legend>
              {plainFields(kind).map((field) => checkbox(field))}
            </fieldset>
            <Field label={t(`${NS}.dialog.expiry`)} htmlFor="share-link-expiry">
              <Select
                id="share-link-expiry"
                value={shownExpiry}
                onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}
              >
                {choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`${NS}.dialog.expiryOptions.${choice}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <section aria-label={t(`${NS}.dialog.preview`)} className="flex flex-col gap-2">
              <h3 className="font-semibold">{t(`${NS}.dialog.preview`)}</h3>
              {fields.length === 0 && <p className="t-caption">{t(`${NS}.dialog.previewEmpty`)}</p>}
              {fields.length > 0 && previewFailed && (
                <InlineError>{t(`${NS}.dialog.previewFailed`)}</InlineError>
              )}
              {fields.length > 0 && !previewFailed && !preview && (
                <p className="t-caption">{t(`${NS}.dialog.previewLoading`)}</p>
              )}
              {fields.length > 0 && preview && <ShareLinkPreview view={preview.view} />}
              {fields.length > 0 && preview?.photosOmitted && (
                <PhotoOmissionNote omitted={preview.photosOmitted} />
              )}
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Which photos stay out of the link and why — the owner's to know, never the page's. */
function PhotoOmissionNote({ omitted }: { omitted: PhotoOmissions }): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const reasons = (["unsupportedType", "unreadable", "overLimit"] as const)
    .filter((reason) => omitted[reason] > 0)
    .map((reason) => t(`${NS}.dialog.photosOmitted.${reason}`, { count: omitted[reason] }));
  if (reasons.length === 0) return null;
  return (
    <p className="t-caption" role="note">
      {t(`${NS}.dialog.photosOmitted.lead`)} {reasons.join(" · ")}
    </p>
  );
}
