import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { ActionControl, ErrorLine, SettingItem } from "../ui/settings";
import type { ServiceLastTest, ServiceTestResult } from "../../lib/api/externalServices";
import { formatDateTime } from "../../lib/displayFormat";
import { isServiceDisabledError, reasonSentence } from "../ExternalServices/serviceText";
import { logger } from "../../lib/logger";
import type { RowLock } from "./useLockFor";

/**
 * The "Verbindung prüfen" row. Nothing here is simulated: the line under it is
 * what the tester answered, kept with its time (`lastTest`), and a test that
 * cannot run says so in its own words.
 */
export default function TestRow({
  lastTest,
  name,
  run,
  lock,
  onDone,
}: {
  lastTest: ServiceLastTest | null;
  /** The service's name, for "something other than {name} answers there". */
  name: string;
  run: () => Promise<ServiceTestResult>;
  lock?: RowLock;
  /** Reload the page's data: the verdict was persisted server-side. */
  onDone: () => Promise<unknown> | void;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows", "externalServices"]);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ ok: boolean; text: string } | null>(null);

  const start = async (): Promise<void> => {
    setBusy(true);
    setFresh(null);
    try {
      const result = await run();
      setFresh(
        result.ok
          ? {
              ok: true,
              text: t(
                result.usedQuota
                  ? "externalServices:test.resultOkQuota"
                  : "externalServices:test.resultOk"
              ),
            }
          : { ok: false, text: reasonSentence(t, result.reason, name) }
      );
    } catch (err) {
      logger.warn("service test could not run");
      setFresh({
        ok: false,
        text: isServiceDisabledError(err)
          ? reasonSentence(t, "disabled", name)
          : t("settingsRows:services.ui.testCouldNotRun"),
      });
    } finally {
      setBusy(false);
      await onDone();
    }
  };

  return (
    <SettingItem
      title={t("settingsRows:services.tpl.test.t")}
      sub={
        fresh
          ? undefined
          : !lastTest
            ? t("settingsRows:services.ui.neverTested")
            : lastTest.ok
              ? t("settingsRows:services.ui.lastOk", { when: formatDateTime(lastTest.at) })
              : t("settingsRows:services.ui.lastFailed", {
                  when: formatDateTime(lastTest.at),
                  reason: reasonSentence(t, lastTest.reason, name),
                })
      }
      help={t("settingsRows:services.tpl.test.h")}
      locked={lock}
      control={
        <ActionControl
          label={
            busy ? t("settingsRows:services.ui.testing") : t("settingsRows:services.tpl.test.btn")
          }
          busy={busy}
          onClick={() => void start()}
        />
      }
    >
      {fresh ? (
        fresh.ok ? (
          <p role="status" className="t-caption" style={{ color: "var(--ts-good)", margin: 0 }}>
            {fresh.text}
          </p>
        ) : (
          <ErrorLine>{fresh.text}</ErrorLine>
        )
      ) : null}
    </SettingItem>
  );
}
