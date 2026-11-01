import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatDateTime } from "../../../lib/displayFormat";
import { logger } from "../../../lib/logger";
import {
  sourcesErrorKey,
  travTrackSourcesApi,
  type CreatedIngestToken,
  type IngestToken,
  type IngestTokenKind,
} from "../../../lib/api/travtrackSources";
import Button from "../../ui/Button";
import { Field, Input, Select } from "../../ui/Field";
import { SettingItem } from "../../ui/settings";
import { useBlockConfirm } from "../useBlockConfirm";
import { RowFailure, useRowAction } from "./useRowAction";

const NS = "settings:location.tt.apps";
const TRACK = "track:sources";

/** Read-only, selected whole on focus: the way a key is copied off the page. */
function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} value={value} readOnly onFocus={(e) => e.currentTarget.select()} />
    </Field>
  );
}

/**
 * "Weitere Apps" (expert): OwnTracks and Overland post positions with a key per
 * device. A new key is shown ONCE with the address and the app's own field
 * names; afterwards only its name and last use are listed. Revoking goes
 * through the confirmation block. These apps do not know the privacy zones —
 * the help says the server drops points inside.
 */
export default function TravTrackAppsRow({
  canCreate,
  canRevoke,
}: {
  canCreate: boolean;
  canRevoke: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settings", "track"]);
  const { confirm, dialog } = useBlockConfirm();
  const [tokens, setTokens] = useState<IngestToken[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [kind, setKind] = useState<IngestTokenKind>("owntracks");
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<CreatedIngestToken | null>(null);
  const create = useRowAction((err) => {
    const key = sourcesErrorKey(err);
    return key === "track:errors.generic" ? t(`${NS}.notCreated`) : t(key);
  });
  const revoke = useRowAction((err) => {
    const key = sourcesErrorKey(err);
    return key === "track:errors.generic" ? t(`${NS}.notRevoked`) : t(key);
  });

  const load = useCallback(async (): Promise<void> => {
    try {
      setTokens(await travTrackSourcesApi.list());
      setLoadFailed(false);
    } catch (err) {
      logger.warn("TravTrack sources: could not load", err);
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const createToken = (): Promise<boolean> => {
    setCreated(null);
    return create.run(async () => {
      setCreated(await travTrackSourcesApi.create({ kind, label: label.trim() }));
      setLabel("");
      await load();
    });
  };

  const revokeToken = (row: IngestToken): Promise<boolean> =>
    revoke.run(async () => {
      const agreed = await confirm({
        title: t(`${NS}.revokeTitle`, { name: row.label }),
        affects: t(`${NS}.revokeAffects`, {
          name: row.label,
          kind: t(`${TRACK}.kinds.${row.kind}`),
        }),
        amount: t(`${NS}.revokeAmount`),
        after: t(`${NS}.revokeAfter`),
        confirmLabel: t(`${NS}.revokeDo`),
      });
      if (!agreed) return;
      await travTrackSourcesApi.revoke(row.id);
      if (created?.id === row.id) setCreated(null);
      await load();
    });

  const urlLabel = created ? t(`${TRACK}.${created.kind}.url`) : "";
  const secretLabel = created
    ? t(`${TRACK}.${created.kind === "owntracks" ? "owntracks.password" : "overland.token"}`)
    : "";

  return (
    <SettingItem expert title={t(`${NS}.name`)} sub={t(`${NS}.sub`)} help={t(`${NS}.help`)}>
      {canCreate ? (
        <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
          <Field label={t(`${NS}.kind`)} htmlFor="travtrack-source-kind">
            <Select
              id="travtrack-source-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as IngestTokenKind)}
            >
              <option value="owntracks">{t(`${TRACK}.kinds.owntracks`)}</option>
              <option value="overland">{t(`${TRACK}.kinds.overland`)}</option>
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
          <Button disabled={create.busy || label.trim() === ""} onClick={() => void createToken()}>
            {t(`${NS}.create`)}
          </Button>
        </div>
      ) : null}
      <RowFailure error={create.error} onRetry={create.retry} />

      {created ? (
        <div
          className="flex flex-col"
          role="status"
          data-testid="travtrack-source-created"
          style={{ gap: "var(--ts-space-sm)" }}
        >
          <p className="t-caption" style={{ margin: 0 }}>
            {t(`${NS}.shownOnce`)}
          </p>
          <p className="t-caption" style={{ margin: 0 }}>
            {t(`${TRACK}.${created.kind}.howTo`)}
          </p>
          <CopyField id="travtrack-source-url" label={urlLabel} value={created.url} />
          <CopyField id="travtrack-source-token" label={secretLabel} value={created.token} />
          <div>
            <Button onClick={() => setCreated(null)}>{t(`${NS}.done`)}</Button>
          </div>
        </div>
      ) : null}

      {tokens.length === 0 && !loadFailed ? (
        <p className="t-caption" style={{ margin: 0 }}>
          {t(`${NS}.none`)}
        </p>
      ) : (
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {tokens.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <span className="t-body">
                {row.label} · {t(`${TRACK}.kinds.${row.kind}`)} ·{" "}
                {row.lastUsedAt
                  ? t(`${NS}.lastUsed`, { at: formatDateTime(row.lastUsedAt) })
                  : t(`${NS}.neverUsed`)}
              </span>
              {canRevoke ? (
                <Button
                  disabled={revoke.busy}
                  aria-label={`${t(`${NS}.revoke`)}: ${row.label}`}
                  onClick={() => void revokeToken(row)}
                >
                  {t(`${NS}.revoke`)}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <RowFailure error={loadFailed ? t(`${NS}.loadError`) : null} onRetry={() => void load()} />
      <RowFailure error={revoke.error} onRetry={revoke.retry} />
      {dialog}
    </SettingItem>
  );
}
