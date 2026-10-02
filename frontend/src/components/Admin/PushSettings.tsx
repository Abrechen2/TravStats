import { useEffect, useState } from "react";
import type { JSX } from "react";
import { pushRelayApi, type PushRelayState } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { todayZoneNow } from "../../hooks/useTodayZone";

const PRIVACY_URL = "https://travstats.de/datenschutz";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { timeZone: todayZoneNow() });
}

export default function PushSettings(): JSX.Element {
  const { t } = useTranslation(["pushRelay", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState<PushRelayState | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void pushRelayApi
      .get()
      .then((s) => {
        if (cancelled) return;
        setState(s);
        setUrl(s.pushRelayUrl);
      })
      .catch((error: unknown) => {
        logger.debug("failed to load push settings", error);
        if (!cancelled) addToast("error", t("pushRelay:loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (
    action: () => Promise<PushRelayState>,
    successKey?: string,
    failKey = "pushRelay:saveFailed"
  ): Promise<void> => {
    setBusy(true);
    try {
      // Never flip the displayed state optimistically: it must stay truthful on failure.
      const next = await action();
      setState(next);
      setUrl(next.pushRelayUrl);
      if (successKey) addToast("success", t(successKey));
    } catch (error) {
      logger.debug("failed to change push settings", error);
      addToast("error", t(failKey));
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return <p style={{ color: "var(--text-muted)" }}>{t("common:loading.title")}</p>;
  }

  const muted = { color: "var(--text-muted)" };

  return (
    <section className="flex flex-col gap-4 p-6">
      <h3 className="font-medium" style={{ color: "var(--text-primary)" }}>
        {t("pushRelay:title")}
      </h3>

      <label className="flex items-start gap-3 text-sm" style={{ color: "var(--text-primary)" }}>
        <input
          type="checkbox"
          checked={state.pushEnabled}
          disabled={busy}
          onChange={(e) => void run(() => pushRelayApi.update({ pushEnabled: e.target.checked }))}
          className="mt-1 h-4 w-4 rounded-sm border-(--border)"
        />
        <span className="font-medium">{t("pushRelay:enable")}</span>
      </label>

      <div className="flex flex-col gap-2 text-sm" style={muted}>
        <p>{t("pushRelay:explanation.operator")}</p>
        <p>{t("pushRelay:explanation.receives")}</p>
        <p>{t("pushRelay:explanation.stores")}</p>
        <p>{t("pushRelay:defaultOff")}</p>
        <p>{t("pushRelay:ownRelay")}</p>
        <p className="flex flex-wrap gap-4">
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="underline">
            {t("pushRelay:privacyLink")}
          </a>
        </p>
        {state.pushEnabled && state.consentAt && (
          <p>{t("pushRelay:consentAt", { time: formatTime(state.consentAt) })}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="push-relay-url"
          className="text-sm font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {t("pushRelay:relayUrl")}
        </label>
        <div className="flex gap-2">
          <input
            id="push-relay-url"
            type="url"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 rounded-sm border px-2 py-1 text-sm"
            style={{ borderColor: "var(--border)", background: "transparent" }}
          />
          <button
            type="button"
            disabled={busy || url === state.pushRelayUrl}
            onClick={() =>
              void run(
                () => pushRelayApi.update({ pushRelayUrl: url }),
                "pushRelay:saved",
                "pushRelay:invalidUrl"
              )
            }
            className="rounded-sm border px-3 py-1 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {t("pushRelay:saveUrl")}
          </button>
        </div>
        <span className="text-xs" style={muted}>
          {t("pushRelay:relayUrlHint")}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {t("pushRelay:registration")}
        </span>
        <span data-testid="push-registration" style={muted}>
          {state.registered ? t("pushRelay:registered") : t("pushRelay:notRegistered")}
        </span>
        {!state.registered && state.pushEnabled && (
          <span className="text-xs" style={muted}>
            {t("pushRelay:notRegisteredHint")}
          </span>
        )}
        {state.pausedUntil && (
          <span style={muted}>
            {t("pushRelay:pausedUntil", { time: formatTime(state.pausedUntil) })}
          </span>
        )}
        <div>
          <button
            type="button"
            disabled={busy || (!state.registered && !state.pausedUntil)}
            onClick={() => void run(() => pushRelayApi.reset(), "pushRelay:resetDone")}
            className="mt-1 rounded-sm border px-3 py-1 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {t("pushRelay:reset")}
          </button>
        </div>
      </div>
    </section>
  );
}
