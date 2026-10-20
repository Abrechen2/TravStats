import { useEffect, useState } from "react";
import type { JSX } from "react";
import { adminApi, type ImportModeState } from "../../lib/api";
import { formatDateTime } from "../../lib/displayFormat";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import Button from "../ui/Button";
import { Field, Select } from "../ui/Field";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";

const NS = "admin:importMode";

interface Account {
  id: string;
  username: string;
}

/**
 * Import mode (forgejo#304): lift the upload and import limits for a first
 * import, for 24 hours, for every account or one. It ends by itself.
 */
export default function ImportModeSettings(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [mode, setMode] = useState<ImportModeState | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [target, setTarget] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([adminApi.getImportMode(), adminApi.getUsers()]).then(
      ([state, { users }]) => {
        if (!alive) return;
        setMode(state);
        setAccounts(users.filter((u) => u.isActive).map(({ id, username }) => ({ id, username })));
      },
      (error: unknown) => {
        logger.error("Loading the import mode failed:", error);
        if (alive) setLoadFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const save = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setSaveFailed(false);
    try {
      setMode(
        await adminApi.setImportMode(enabled ? { enabled, userId: target || null } : { enabled })
      );
    } catch (error) {
      logger.error("Saving the import mode failed:", error);
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const covered = mode?.userId ? accounts.find((a) => a.id === mode.userId)?.username : null;

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      {mode && mode.until && (
        <div className="space-y-3">
          <p role="status">
            {mode.userId
              ? t(`${NS}.activeFor`, {
                  until: formatDateTime(mode.until),
                  account: covered ?? t(`${NS}.unknownAccount`),
                })
              : t(`${NS}.activeAll`, { until: formatDateTime(mode.until) })}
          </p>
          <Button variant="secondary" disabled={busy} onClick={() => void save(false)}>
            {t(`${NS}.stop`)}
          </Button>
        </div>
      )}
      {mode && !mode.until && (
        <div className="space-y-3">
          <p role="status">{t(`${NS}.off`)}</p>
          <Field label={t(`${NS}.account`)} htmlFor="import-mode-account">
            <Select
              id="import-mode-account"
              value={target}
              disabled={busy}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{t(`${NS}.allAccounts`)}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" disabled={busy} onClick={() => void save(true)}>
            {t(`${NS}.start`, { hours: mode.hours })}
          </Button>
        </div>
      )}
      {loadFailed && <p role="alert">{t(`${NS}.loadFailed`)}</p>}
      {saveFailed && <p role="alert">{t(`${NS}.saveFailed`)}</p>}
    </SectionCard>
  );
}
