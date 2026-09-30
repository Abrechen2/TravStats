import { useState } from "react";
import type { JSX } from "react";
import axios from "axios";

import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import type { RailRoutingTestResult } from "../../lib/api/admin";
import { logger } from "../../lib/logger";
import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";

type SaveState = { kind: "idle" } | { kind: "saved" } | { kind: "error"; key: string };
type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: RailRoutingTestResult }
  | { kind: "failed" };

/**
 * The base URL of a self-hosted OpenRailRouting (rail-domain phase 3). Empty
 * means off — the default. When set, a rail journey without a Transitous trace
 * gets its line routed over the tracks, once, when it is saved.
 *
 * The test asks the TYPED URL, so an admin learns it is wrong before saving
 * it; its answer is a code mapped to DE/EN copy, never the server's text.
 */
export default function RailRoutingUrlSetting({
  savedUrl,
  onSaved,
}: {
  savedUrl: string | null;
  onSaved: (url: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [url, setUrl] = useState(savedUrl ?? "");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setSave({ kind: "idle" });
    try {
      const { settings } = await adminApi.updateInstanceSettings({ railRoutingUrl: url.trim() });
      const stored = settings.railRoutingUrl ?? null;
      setUrl(stored ?? "");
      onSaved(stored);
      setSave({ kind: "saved" });
    } catch (err) {
      logger.warn("Saving the OpenRailRouting URL failed", err);
      const invalid = axios.isAxiosError(err) && err.response?.status === 400;
      setSave({
        kind: "error",
        key: invalid ? "settings:railRouting.invalidUrl" : "settings:railRouting.saveError",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTest({ kind: "running" });
    try {
      setTest({ kind: "done", result: await adminApi.testRailRouting(url.trim() || undefined) });
    } catch (err) {
      logger.warn("Testing the OpenRailRouting URL failed", err);
      setTest({ kind: "failed" });
    }
  };

  const testLine =
    test.kind === "done"
      ? test.result.ok
        ? {
            ok: true,
            text: t("settings:railRouting.test.ok", {
              profile: test.result.profile,
              date: test.result.dataDate ?? "—",
            }),
          }
        : { ok: false, text: t(`settings:railRouting.test.${test.result.code}`) }
      : test.kind === "failed"
        ? { ok: false, text: t("settings:railRouting.test.requestFailed") }
        : null;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <Field
        label={t("settings:railRouting.label")}
        htmlFor="rail-routing-url"
        hint={t("settings:railRouting.hint")}
        error={save.kind === "error" ? t(save.key) : undefined}
      >
        <Input
          id="rail-routing-url"
          type="url"
          inputMode="url"
          placeholder="http://openrailrouting.lan:8989"
          value={url}
          invalid={save.kind === "error"}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {t("settings:railRouting.save")}
        </Button>
        <Button
          onClick={() => void handleTest()}
          disabled={test.kind === "running" || (url.trim() === "" && !savedUrl)}
        >
          {t("settings:railRouting.testButton")}
        </Button>
      </div>
      {save.kind === "saved" && (
        <p className="t-caption" role="status">
          {t(url.trim() ? "settings:railRouting.saved" : "settings:railRouting.switchedOff")}
        </p>
      )}
      {testLine && (
        <p
          className="t-caption"
          role={testLine.ok ? "status" : "alert"}
          style={{ color: testLine.ok ? "var(--ts-good)" : "var(--ts-bad)" }}
        >
          {testLine.text}
        </p>
      )}
    </div>
  );
}
