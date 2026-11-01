import { useEffect, useState, type JSX } from "react";
import { adminApi } from "../../lib/api";
import type {
  AdminParserSettingsResponse,
  CloudProviderKind,
  ParserOrder,
} from "../../lib/api/admin";
import { logger } from "../../lib/logger";
import { resetHasLlmCache } from "../../hooks/useHasLlm";
import { useTranslation } from "../../hooks/useTranslation";
import { useRowCopy } from "../Settings/rowCopy";
import Button from "../ui/Button";
import {
  ActionControl,
  ChoiceControl,
  ErrorLine,
  SettingItem,
  StatusValue,
  SwitchControl,
  useGroupSave,
} from "../ui/settings";
import CloudOrderList from "./CloudOrderList";
import { completeOrder } from "./cloudOrder";
import GroupFooter from "./GroupFooter";

interface Draft extends Record<string, unknown> {
  parserOrder: ParserOrder;
  llmEnabled: boolean;
  providerOrder: CloudProviderKind[];
}

const draftOf = (s: AdminParserSettingsResponse): Draft => ({
  parserOrder: s.parserOrder ?? "template_first",
  llmEnabled: s.llmEnabled ?? true,
  providerOrder: completeOrder(s.llmProviderOrder),
});

/**
 * Server › Buchungen lesen (design C4): who reads first, whether any model may
 * be asked, and the order of the cloud chain — one group with one save. The
 * Ollama address, model and downloads live in Dienste; only the check stays,
 * because it answers "does reading work", which is this page's question.
 */
export default function ServerParsers(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const [settings, setSettings] = useState<AdminParserSettingsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    adminApi.getAdminParserSettings().then(
      (s) => {
        if (!alive) return;
        setSettings(s);
        setFailed(false);
      },
      (error: unknown) => {
        logger.error("Failed to load parser settings", error);
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (settings) return <Rows settings={settings} onSaved={setSettings} />;
  if (failed) {
    return (
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <ErrorLine>{t("settingsRows:server.loadFailed")}</ErrorLine>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t("settingsRows:server.retry")}
        </Button>
      </div>
    );
  }
  return <div style={{ minHeight: 80 }} aria-busy="true" />;
}

type TestResult =
  { status: "ok" | "warn"; model?: string } | { status: "unreachable" } | { status: "failed" };

function Rows({
  settings,
  onSaved,
}: {
  settings: AdminParserSettingsResponse;
  onSaved: (next: AdminParserSettingsResponse) => void;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const row = useRowCopy("server");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const group = useGroupSave<Draft>({
    id: "server-parsers",
    label: t("settingsRows:server.groups.parsers"),
    saved: draftOf(settings),
    write: async (draft) => {
      await adminApi.updateAdminParserSettings({
        parserOrder: draft.parserOrder,
        llmEnabled: draft.llmEnabled,
        llmProviderOrder: draft.providerOrder,
      });
      // Re-read: what is stored is the server's answer, not the draft.
      const fresh = await adminApi.getAdminParserSettings();
      onSaved(fresh);
      // The KI-Parser row of Dienste reads the parser's capabilities, cached per tab.
      resetHasLlmCache();
      return draftOf(fresh);
    },
  });

  const runTest = async (): Promise<void> => {
    if (!settings.ollamaUrl || !settings.ollamaModel) return;
    setTesting(true);
    setResult(null);
    try {
      const r = await adminApi.testOllamaConnection(settings.ollamaUrl, settings.ollamaModel);
      if (!r.success) setResult({ status: "unreachable" });
      else
        setResult(r.warning ? { status: "warn", model: settings.ollamaModel } : { status: "ok" });
    } catch (error) {
      logger.error("Testing Ollama failed:", error);
      setResult({ status: "failed" });
    } finally {
      setTesting(false);
    }
  };

  const first = row("leserfolge");
  const ai = row("kiaktiv");
  const cloud = row("cloudorder");
  const builtin = row("builtin");
  const test = row("olltest");
  const hasOllama = Boolean(settings.ollamaUrl && settings.ollamaModel);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SettingItem
        title={first.title}
        help={first.help}
        scope="allAccounts"
        changed={group.isChanged("parserOrder")}
        control={
          <ChoiceControl<ParserOrder>
            label={first.title}
            value={group.draft.parserOrder}
            options={[
              { value: "template_first", label: t("settingsRows:server.parsers.templateFirst") },
              { value: "llm_first", label: t("settingsRows:server.parsers.llmFirst") },
            ]}
            onChange={(next) => group.edit({ parserOrder: next })}
          />
        }
      />
      <SettingItem
        title={ai.title}
        sub={ai.sub}
        help={ai.help}
        scope="allAccounts"
        changed={group.isChanged("llmEnabled")}
        control={
          <SwitchControl
            checked={group.draft.llmEnabled}
            onChange={(next) => group.edit({ llmEnabled: next })}
          />
        }
      />
      <SettingItem
        title={cloud.title}
        sub={cloud.sub}
        help={cloud.help}
        scope="allAccounts"
        changed={group.isChanged("providerOrder")}
      >
        <CloudOrderList
          order={group.draft.providerOrder}
          onChange={(next) => group.edit({ providerOrder: next })}
        />
      </SettingItem>
      <SettingItem
        title={builtin.title}
        scope="allAccounts"
        control={<StatusValue>{t("settingsRows:server.parsers.builtin")}</StatusValue>}
      />
      <GroupFooter group={group} />
      <SettingItem
        title={test.title}
        scope="allAccounts"
        dependency={hasOllama ? undefined : { reason: t("settingsRows:server.parsers.noOllama") }}
        control={
          <ActionControl
            label={
              testing ? t("settingsRows:server.running") : t("settingsRows:server.parsers.check")
            }
            busy={testing}
            onClick={() => void runTest()}
          />
        }
      >
        {result ? (
          result.status === "ok" || result.status === "warn" ? (
            <p
              role="status"
              className="t-caption"
              style={{
                margin: 0,
                color: result.status === "ok" ? "var(--ts-good)" : "var(--ts-warn)",
              }}
            >
              {result.status === "ok"
                ? t("settingsRows:server.parsers.testOk")
                : t("settingsRows:server.parsers.testNoModel", { model: result.model })}
            </p>
          ) : (
            <ErrorLine>{t(`settingsRows:server.parsers.test_${result.status}`)}</ErrorLine>
          )
        ) : null}
      </SettingItem>
    </div>
  );
}
