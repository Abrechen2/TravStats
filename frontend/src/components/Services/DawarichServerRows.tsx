import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { dawarichAdminApi, dawarichFailureKind } from "../../lib/api/dawarich";
import { JobLostError } from "../../lib/api/jobs";
import { apiErrorMachineCode } from "../../lib/apiError";
import { ActionControl, ErrorLine, SettingItem } from "../ui/settings";
import type { ServiceField } from "../../lib/api/externalServices";
import FieldsGroup from "./FieldsGroup";
import TestRow from "./TestRow";
import { useLoaded } from "./useLoaded";
import { useDemoLock } from "./useLockFor";

const REASON_OF_KIND: Record<string, string> = {
  auth: "auth",
  unreachable: "network",
  timeout: "timeout",
  notConfigured: "not_found",
  notFound: "not_found",
  invalidUrl: "not_found",
  protocol: "http_error",
  keyRequired: "auth",
};

/**
 * Dawarich has no row in the admin catalogue (`adminRow: false`), so the
 * server's connection is read and written through `/admin/dawarich`. It is the
 * fallback for accounts with no connection of their own — and nothing else:
 * the location source and the stay scan read only an account's own.
 */
export default function DawarichServerRows(): JSX.Element | null {
  const { t } = useTranslation(["settingsRows"]);
  const demo = useDemoLock();
  const { data, setData, failed, reload } = useLoaded(() => dawarichAdminApi.getSettings());
  const [sweeping, setSweeping] = useState(false);
  const [sweep, setSweep] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  if (failed) return <ErrorLine>{t("settingsRows:services.ui.loadFailed")}</ErrorLine>;
  if (!data) return null;

  const fields: ServiceField[] = [
    { key: "baseUrl", kind: "url", value: data.baseUrl, expert: false },
    { key: "apiKey", kind: "secret", value: data.apiKey, masked: true, expert: false },
  ];
  const runSweep = async (): Promise<void> => {
    setSweeping(true);
    setSweep(null);
    try {
      const r = await dawarichAdminApi.sweepNow();
      const clean = r.failed === 0 && r.degraded === 0;
      setSweep({
        ok: clean,
        text: t(
          clean ? "settingsRows:services.ui.sweepDone" : "settingsRows:services.ui.sweepPartial",
          { users: r.users, days: r.daysWritten, failed: r.failed + r.degraded }
        ),
      });
    } catch (err) {
      setSweep({
        ok: false,
        text:
          err instanceof JobLostError
            ? t("settingsRows:services.ui.sweepLost")
            : apiErrorMachineCode(err) === "SWEEP_RUNNING"
              ? t("settingsRows:services.ui.sweepRunning")
              : t("settingsRows:services.ui.sweepFailed"),
      });
    } finally {
      setSweeping(false);
    }
  };

  return (
    <>
      <FieldsGroup
        id="services.dawarich.server"
        label={t("settingsRows:services.ui.serverGroup", { name: "Dawarich" })}
        serviceId="dawarich"
        fields={fields}
        secretTemplate="instKey"
        tests
        lock={demo}
        errorText={saveError}
        write={async (changes) => {
          setSaveError(null);
          try {
            // A secret left empty is not in `changes`: the stored key stays.
            setData(
              await dawarichAdminApi.updateSettings({
                ...(typeof changes.baseUrl === "string"
                  ? { baseUrl: changes.baseUrl.trim() || null }
                  : {}),
                ...(typeof changes.apiKey === "string"
                  ? { apiKey: changes.apiKey.trim() || null }
                  : {}),
              })
            );
          } catch (err) {
            setSaveError(t("settingsRows:services.ui.saveFailed"));
            throw err;
          }
        }}
        onRemoveSecret={async () => {
          setData(await dawarichAdminApi.updateSettings({ apiKey: null }));
        }}
      />
      <TestRow
        lastTest={null}
        name="Dawarich"
        lock={demo}
        run={async () => {
          try {
            const r = await dawarichAdminApi.testConnection({});
            return {
              ok: r.success,
              reason: r.success ? null : (REASON_OF_KIND[r.kind ?? ""] ?? "http_error"),
              usedQuota: false,
            };
          } catch (err) {
            const kind = dawarichFailureKind(err);
            return { ok: false, reason: REASON_OF_KIND[kind ?? ""] ?? "network", usedQuota: false };
          }
        }}
        onDone={reload}
      />
      <SettingItem
        title={t("settingsRows:services.rows.dawsweep.t")}
        sub={t("settingsRows:services.rows.dawsweep.s")}
        scope="allAccounts"
        locked={demo}
        control={
          <ActionControl
            label={
              sweeping
                ? t("settingsRows:services.ui.running")
                : t("settingsRows:services.rows.dawsweep.btn")
            }
            busy={sweeping}
            onClick={() => void runSweep()}
          />
        }
      >
        {sweep ? (
          sweep.ok ? (
            <p role="status" className="t-caption" style={{ color: "var(--ts-good)", margin: 0 }}>
              {sweep.text}
            </p>
          ) : (
            <ErrorLine>{sweep.text}</ErrorLine>
          )
        ) : null}
      </SettingItem>
    </>
  );
}
