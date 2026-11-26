import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { ActionControl, ErrorLine, SettingItem } from "../ui/settings";
import type { ServiceLastTest, ServiceTestResult } from "../../lib/api/externalServices";
import { formatDateTime } from "../../lib/format";
import { isServiceDisabledError, reasonSentence } from "../ExternalServices/serviceText";
import { logger } from "../../lib/logger";
import type { RowLock } from "./useLockFor";

/** " · <whose key>" for a verdict that used a credential; empty when nothing was called. */
function sourceSuffix(t: ReturnType<typeof useTranslation>["t"], source?: string): string {
  if (source !== "account" && source !== "instance") return "";
  return ` · ${t(`settingsRows:services.ui.testedWith.${source}`)}`;
}

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
  effective = false,
}: {
  lastTest: ServiceLastTest | null;
  /** The service's name, for "something other than {name} answers there". */
  name: string;
  run: () => Promise<ServiceTestResult>;
  lock?: RowLock;
  /** Reload the page's data: the verdict was persisted server-side. */
  onDone: () => Promise<unknown> | void;
  /** The row tests the key this viewer's requests really use, not the stored instance one. */
  effective?: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows", "externalServices"]);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ ok: boolean; text: string } | null>(null);

  const start = async (): Promise<void> => {
    setBusy(true);
    setFresh(null);
    try {
      const result = await run();
      if (result.storedInstanceVerdict && result.lastTest) {
        const ok = result.lastTest.ok;
        setFresh({
          ok,
          text: t("settingsRows:services.ui.storedVerdict", {
            result: t(
              ok ? "settingsRows:services.ui.storedOk" : "settingsRows:services.ui.storedFailed"
            ),
            when: formatDateTime(result.lastTest.at),
          }),
        });
        return;
      }
      setFresh(
        result.ok
          ? {
              ok: true,
              text:
                t(
                  result.usedQuota
                    ? "externalServices:test.resultOkQuota"
                    : "externalServices:test.resultOk"
                ) + sourceSuffix(t, result.source),
            }
          : {
              ok: false,
              text: reasonSentence(t, result.reason, name) + sourceSuffix(t, result.source),
            }
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
      title={t(
        effective ? "settingsRows:services.ui.testEffectiveT" : "settingsRows:services.tpl.test.t"
      )}
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
      help={t(
        effective ? "settingsRows:services.ui.testEffectiveH" : "settingsRows:services.tpl.test.h"
      )}
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
