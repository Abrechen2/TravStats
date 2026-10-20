import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { shareLinksApi } from "../../lib/api/shareLinks";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import {
  SHARE_LINK_DEFAULT_FIELDS,
  SHARE_LINK_FIELDS,
  type CreatedShareLink,
  type PhotoOmissions,
  type ShareLinkKind,
  type ShareLinkPreviewResult,
} from "../../types/shareLinks";
import Modal from "../Modal";
import Button from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";
import { EXPIRY_CHOICES, shareLinkErrorKey, type ExpiryChoice } from "./shareLinkCopy";
import ShareLinkPreview from "./ShareLinkPreview";

const NS = "sharing:links";

type Status = "loading" | "enabled" | "disabled" | "failed";

/**
 * "Als Link teilen" (forgejo#281): pick what a public page shows, see exactly
 * that in the preview, choose how long it lives, create it — and copy the URL,
 * which is shown this once (the server keeps only its hash).
 *
 * The preview is the server's own serializer, asked with the current choice,
 * so it cannot claim less than the link will show. While the instance switch
 * is off the dialog says so instead of offering a form that can only fail.
 */
export default function ShareLinkDialog({
  open,
  onClose,
  kind,
  targetId,
}: {
  open: boolean;
  onClose: () => void;
  kind: ShareLinkKind;
  targetId: string;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const format = useDisplayFormat();
  const [status, setStatus] = useState<Status>("loading");
  const [fields, setFields] = useState<string[]>([...SHARE_LINK_DEFAULT_FIELDS[kind]]);
  const [expiry, setExpiry] = useState<ExpiryChoice>(kind === "flight" ? "untilLanding" : "week");
  const [preview, setPreview] = useState<ShareLinkPreviewResult | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [created, setCreated] = useState<CreatedShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, [open, status, kind, targetId, selectionKey, created]);

  const toggle = (field: string, on: boolean): void =>
    setFields((current) => (on ? [...current, field] : current.filter((f) => f !== field)));

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const expiresInDays = EXPIRY_CHOICES[expiry];
      setCreated(await shareLinksApi.create({ kind, targetId, fields, expiresInDays }));
    } catch (err) {
      logger.error("Creating a share link failed:", err);
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
    onClose();
  };

  const choices = (Object.keys(EXPIRY_CHOICES) as ExpiryChoice[]).filter(
    (choice) => kind === "flight" || choice !== "untilLanding"
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={t(`${NS}.dialog.title`)}
      busy={busy}
      maxWidth={560}
      footer={
        status === "enabled" && !created ? (
          <Button
            variant="primary"
            disabled={busy || fields.length === 0}
            onClick={() => void create()}
          >
            {t(`${NS}.dialog.create`)}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {status === "disabled" && <p role="status">{t(`${NS}.dialog.disabled`)}</p>}
        {status === "failed" && (
          <p role="alert" style={{ color: "var(--ts-bad)" }}>
            {t(`${NS}.dialog.statusFailed`)}
          </p>
        )}
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
              {copied === "failed" && (
                <span role="alert" style={{ color: "var(--ts-bad)" }}>
                  {t(`${NS}.dialog.copyFailed`)}
                </span>
              )}
            </div>
            <p className="t-caption">
              {t(`${NS}.dialog.endsAt`, { date: format.dateTime(created.effectiveExpiresAt) })}
            </p>
          </>
        )}
        {status === "enabled" && !created && (
          <>
            <p className="t-caption">{t(`${NS}.dialog.warning`)}</p>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 font-semibold">{t(`${NS}.dialog.fieldsTitle`)}</legend>
              {SHARE_LINK_FIELDS[kind].map((field) => (
                <div key={field} className="flex flex-col">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fields.includes(field)}
                      onChange={(e) => toggle(field, e.target.checked)}
                      aria-describedby={
                        field === "itinerary" ? "share-link-itinerary-hint" : undefined
                      }
                    />
                    {t(`${NS}.fields.${kind}.${field}`)}
                  </label>
                  {field === "itinerary" && (
                    <p id="share-link-itinerary-hint" className="t-caption ml-6">
                      {t(`${NS}.dialog.itineraryHint`)}
                    </p>
                  )}
                </div>
              ))}
            </fieldset>
            <Field label={t(`${NS}.dialog.expiry`)} htmlFor="share-link-expiry">
              <Select
                id="share-link-expiry"
                value={expiry}
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
                <p role="alert" style={{ color: "var(--ts-bad)" }}>
                  {t(`${NS}.dialog.previewFailed`)}
                </p>
              )}
              {fields.length > 0 && !previewFailed && !preview && (
                <p className="t-caption">{t(`${NS}.dialog.previewLoading`)}</p>
              )}
              {fields.length > 0 && preview && <ShareLinkPreview view={preview.view} />}
              {fields.length > 0 && preview?.photosOmitted && (
                <PhotoOmissionNote omitted={preview.photosOmitted} />
              )}
            </section>
            {error && (
              <p role="alert" style={{ color: "var(--ts-bad)" }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
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
