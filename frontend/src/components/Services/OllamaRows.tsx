import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import { ActionControl, ErrorLine, InputControl, SettingItem, StatusValue } from "../ui/settings";
import type { AdminService } from "../../lib/api/externalServices";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import { useDemoLock } from "./useLockFor";

type Models = { name: string }[];

/**
 * Ollama's models, from the server's own address: which are installed, and a
 * pull for one that is not. Both ask Ollama itself; nothing here is a stand-in.
 */
export default function OllamaRows({ service }: { service: AdminService }): JSX.Element | null {
  const { t } = useTranslation(["settingsRows"]);
  const demo = useDemoLock();
  const expert = useExpertRows(1);
  const url = String(service.fields.find((f) => f.key === "url")?.value ?? "");
  const [models, setModels] = useState<Models | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [wanted, setWanted] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pull, setPull] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async (): Promise<void> => {
    try {
      const r = await adminApi.listOllamaModels(url);
      setListFailed(!r.success);
      setModels(r.success ? (r.models ?? []) : null);
    } catch {
      setListFailed(true);
      setModels(null);
    }
  };
  useEffect(() => {
    if (!url) return;
    void load();
  }, [url]);

  if (!expert || !url) return null;

  const runPull = async (): Promise<void> => {
    if (!wanted.trim()) return;
    setPulling(true);
    setPull(null);
    try {
      const r = await adminApi.pullOllamaModel(url, wanted.trim());
      setPull(
        r.success
          ? { ok: true, text: t("settingsRows:services.ui.pullDone", { model: wanted.trim() }) }
          : { ok: false, text: t("settingsRows:services.ui.pullFailed") }
      );
      if (r.success) await load();
    } catch {
      setPull({ ok: false, text: t("settingsRows:services.ui.pullFailed") });
    } finally {
      setPulling(false);
    }
  };

  return (
    <>
      <SettingItem
        title={t("settingsRows:services.ui.ollamaModels")}
        expert
        scope="allAccounts"
        control={
          <StatusValue>
            {models
              ? models.length > 0
                ? models.map((m) => m.name).join(", ")
                : t("settingsRows:services.ui.noModels")
              : listFailed
                ? t("settingsRows:services.ui.modelsUnknown")
                : "…"}
          </StatusValue>
        }
      />
      <SettingItem
        title={t("settingsRows:services.rows.ollpull.t")}
        expert
        scope="allAccounts"
        locked={demo}
        control={
          <>
            <InputControl value={wanted} onChange={setWanted} placeholder="llama3.1:8b" />
            <ActionControl
              label={
                pulling
                  ? t("settingsRows:services.ui.running")
                  : t("settingsRows:services.rows.ollpull.btn")
              }
              busy={pulling || !wanted.trim()}
              onClick={() => void runPull()}
            />
          </>
        }
      >
        {pull ? (
          pull.ok ? (
            <p role="status" className="t-caption" style={{ color: "var(--ts-good)", margin: 0 }}>
              {pull.text}
            </p>
          ) : (
            <ErrorLine>{pull.text}</ErrorLine>
          )
        ) : null}
      </SettingItem>
    </>
  );
}
