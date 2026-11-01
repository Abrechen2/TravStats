import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import {
  ActionControl,
  ConfirmDialog,
  ErrorLine,
  SettingItem,
  SettingWriteError,
  SwitchControl,
  useSettingWrite,
} from "../ui/settings";
import { externalServicesApi, type AdminService } from "../../lib/api/externalServices";
import FieldsGroup from "./FieldsGroup";
import { useServices } from "./servicesContext";
import { useDemoLock } from "./useLockFor";

const SMTP_CODES = [
  "SMTP_CONNECTION",
  "SMTP_TLS",
  "SMTP_AUTH",
  "SMTP_TIMEOUT",
  "SMTP_PASSWORD_MISSING",
] as const;

/** The stable code of a failed test, else "unknown": the transport's own text never reaches the page. */
export function smtpTestCode(err: unknown): string {
  const code = (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return typeof code === "string" && (SMTP_CODES as readonly string[]).includes(code)
    ? code
    : "SMTP_UNKNOWN";
}

function fieldValue(service: AdminService, key: string, changes: Record<string, unknown>): unknown {
  return key in changes ? changes[key] : service.fields.find((f) => f.key === key)?.value;
}

/** Mail (SMTP): the switch, the connection group with "Speichern & testen", the test and the delete. */
export default function SmtpRows({ service }: { service: AdminService }): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const { admin } = useServices();
  const demo = useDemoLock();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const on = useSettingWrite<boolean>("services.smtp.on", service.enabled, async (v) => {
    try {
      await externalServicesApi.adminUpdate("smtp", { enabled: v });
    } catch {
      throw new SettingWriteError("rejected");
    }
    await admin?.reload();
  });

  const test = async (changes: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const v = (key: string): unknown => fieldValue(service, key, changes);
      await adminApi.testSmtpConnection({
        host: String(v("host") ?? ""),
        port: Number(v("port") ?? 587),
        secure: v("secure") === true,
        username: String(v("username") ?? ""),
        // Left out: the server tests with the stored password.
        ...(typeof changes.password === "string" && changes.password !== ""
          ? { password: changes.password }
          : {}),
        fromEmail: String(v("fromEmail") ?? ""),
        fromName: String(v("fromName") ?? "TravStats"),
        enabled: service.enabled,
      });
      setResult({ ok: true, text: t("settingsRows:services.ui.smtpOk") });
    } catch (err) {
      setResult({ ok: false, text: t(`settingsRows:services.smtp.${smtpTestCode(err)}`) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setDeleteError(false);
    try {
      await adminApi.deleteSmtpConfig();
      setDeleting(false);
      await admin?.reload();
    } catch {
      setDeleteError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingItem
        title={t("settingsRows:services.rows.smtpon.t")}
        sub={t("settingsRows:services.rows.smtpon.s")}
        scope="allAccounts"
        locked={demo}
        save={on}
        control={<SwitchControl checked={on.value} onChange={on.choose} />}
      />
      <FieldsGroup
        id="services.smtp.server"
        label={t("settingsRows:services.ui.serverGroup", { name: "SMTP" })}
        serviceId="smtp"
        fields={service.fields}
        secretTemplate="instKey"
        tests
        lock={demo}
        errorText={null}
        write={async (changes) => {
          if (!admin || !(await admin.write("smtp", changes))) throw new Error("save refused");
          await test(changes);
        }}
      />
      <SettingItem
        title={t("settingsRows:services.rows.smtptest.t")}
        locked={demo}
        control={
          <ActionControl
            label={
              busy
                ? t("settingsRows:services.ui.testing")
                : t("settingsRows:services.rows.smtptest.btn")
            }
            busy={busy}
            onClick={() => void test({})}
          />
        }
      >
        {result ? (
          result.ok ? (
            <p role="status" className="t-caption" style={{ color: "var(--ts-good)", margin: 0 }}>
              {result.text}
            </p>
          ) : (
            <ErrorLine>{result.text}</ErrorLine>
          )
        ) : null}
      </SettingItem>
      <SettingItem
        title={t("settingsRows:services.rows.smtpdel.t")}
        help={t("settingsRows:services.rows.smtpdel.h")}
        locked={demo}
        control={
          <ActionControl
            danger
            label={t("settingsRows:services.rows.smtpdel.btn")}
            onClick={() => setDeleting(true)}
          />
        }
      />
      <ConfirmDialog
        open={deleting}
        title={t("settingsRows:services.dialogs.smtpdel.title")}
        affects={t("settingsRows:services.dialogs.smtpdel.affects")}
        amount={t("settingsRows:services.dialogs.smtpdel.amount")}
        after={
          <>
            {t("settingsRows:services.dialogs.smtpdel.after")}
            {deleteError ? (
              <ErrorLine>{t("settingsRows:services.ui.deleteFailed")}</ErrorLine>
            ) : null}
          </>
        }
        confirmLabel={t("settingsRows:services.dialogs.smtpdel.confirm")}
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}
