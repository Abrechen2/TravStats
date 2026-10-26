import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import Button from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";
import { token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { formatDateTime } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import {
  sourcesErrorKey,
  travTrackSourcesApi,
  type CreatedIngestToken,
  type IngestToken,
  type IngestTokenKind,
} from "../../lib/api/travtrackSources";

const NS = "track:sources";

type Status = { tone: "ok" | "bad"; text: string } | null;

/** Read-only, selected whole on focus: the way a token is copied off the page. */
function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} value={value} readOnly onFocus={(e) => e.currentTarget.select()} />
    </Field>
  );
}

/**
 * Further sources for TravTrack (TravTrack plan E9), inside the TravTrack
 * settings card: OwnTracks and Overland post positions with a token per
 * device. A new token is shown once, with the URL and the app's own field
 * names; afterwards only its name and last use are listed, and it can be
 * revoked.
 *
 * `canCreate` is false while TravTrack is off, while it is not the account's
 * provider, and for the demo account; `canRevoke` follows the card.
 */
export default function TravTrackSources({
  canCreate,
  canRevoke,
}: {
  canCreate: boolean;
  canRevoke: boolean;
}): JSX.Element {
  const { t } = useTranslation(["track", "common"]);
  const { confirmDelete, confirmDialog } = useConfirmDialog();
  const [tokens, setTokens] = useState<IngestToken[]>([]);
  const [kind, setKind] = useState<IngestTokenKind>("owntracks");
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<CreatedIngestToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTokens(await travTrackSourcesApi.list());
      setLoadError(null);
    } catch (err) {
      logger.warn("TravTrack sources: could not load", err);
      setLoadError(sourcesErrorKey(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setStatus(null);
    setCreated(null);
    try {
      setCreated(await travTrackSourcesApi.create({ kind, label: label.trim() }));
      setLabel("");
      await load();
    } catch (err) {
      logger.warn("TravTrack sources: token not created", err);
      setStatus({ tone: "bad", text: t(sourcesErrorKey(err)) });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: IngestToken) => {
    if (!(await confirmDelete(t(`${NS}.revokeConfirm`, { name: row.label })))) return;
    setBusy(true);
    setStatus(null);
    try {
      await travTrackSourcesApi.revoke(row.id);
      if (created?.id === row.id) setCreated(null);
      setStatus({ tone: "ok", text: t(`${NS}.revoked`, { name: row.label }) });
      await load();
    } catch (err) {
      logger.warn("TravTrack sources: token not revoked", err);
      setStatus({ tone: "bad", text: t(sourcesErrorKey(err)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 className="t-card-title" style={{ marginTop: "var(--ts-space-lg)" }}>
        {t(`${NS}.title`)}
      </h3>
      <p className="t-caption">{t(`${NS}.intro`)}</p>
      <p className="t-caption" data-testid="travtrack-sources-privacy">
        {t(`${NS}.privacy`)}
      </p>

      {canCreate && (
        <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
          <Field label={t(`${NS}.kind`)} htmlFor="travtrack-source-kind">
            <Select
              id="travtrack-source-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as IngestTokenKind)}
            >
              <option value="owntracks">{t(`${NS}.kinds.owntracks`)}</option>
              <option value="overland">{t(`${NS}.kinds.overland`)}</option>
            </Select>
          </Field>
          <Field label={t(`${NS}.label`)} htmlFor="travtrack-source-label">
            <Input
              id="travtrack-source-label"
              value={label}
              maxLength={60}
              placeholder={t(`${NS}.labelPlaceholder`)}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Button disabled={busy || label.trim() === ""} onClick={() => void create()}>
            {t(`${NS}.create`)}
          </Button>
        </div>
      )}

      {created && (
        <div
          className="flex flex-col"
          role="status"
          data-testid="travtrack-source-created"
          style={{ gap: "var(--ts-space-sm)" }}
        >
          <p className="t-body">{t(`${NS}.shownOnce`)}</p>
          {created.kind === "owntracks" ? (
            <>
              <p className="t-caption">{t(`${NS}.owntracks.howTo`)}</p>
              <CopyField
                id="travtrack-source-url"
                label={t(`${NS}.owntracks.url`)}
                value={created.url}
              />
              <CopyField
                id="travtrack-source-token"
                label={t(`${NS}.owntracks.password`)}
                value={created.token}
              />
            </>
          ) : (
            <>
              <p className="t-caption">{t(`${NS}.overland.howTo`)}</p>
              <CopyField
                id="travtrack-source-url"
                label={t(`${NS}.overland.url`)}
                value={created.url}
              />
              <CopyField
                id="travtrack-source-token"
                label={t(`${NS}.overland.token`)}
                value={created.token}
              />
            </>
          )}
          <div>
            <Button onClick={() => setCreated(null)}>{t(`${NS}.done`)}</Button>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {tokens.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <span className="t-body">
                {row.label} · {t(`${NS}.kinds.${row.kind}`)} ·{" "}
                {row.lastUsedAt
                  ? t(`${NS}.lastUsed`, { at: formatDateTime(row.lastUsedAt) })
                  : t(`${NS}.neverUsed`)}
              </span>
              {canRevoke && (
                <Button disabled={busy} onClick={() => void revoke(row)}>
                  {t(`${NS}.revoke`)}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {loadError && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(loadError)}
        </p>
      )}
      {status && (
        <p
          className="t-body"
          role={status.tone === "bad" ? "alert" : "status"}
          style={{ color: token(status.tone === "bad" ? "bad" : "good") }}
        >
          {status.text}
        </p>
      )}
      {confirmDialog}
    </>
  );
}
