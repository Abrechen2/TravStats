import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import { useTranslation } from "../hooks/useTranslation";
import { stravaApi, stravaFailureKind } from "../lib/api/strava";
import { useToastStore } from "../store/toastStore";

/**
 * Where Strava sends the browser back after the consent page.
 *
 * A page, not an API route, on purpose: the auth cookie is SameSite=strict
 * and therefore missing from Strava's cross-site redirect. This page loads,
 * and its own request to `/exchange` is same-site and carries the cookie.
 */
export default function StravaCallbackPage(): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [error, setError] = useState<string | null>(null);
  // StrictMode runs effects twice in development; a code is single-use, and
  // exchanging it twice would report the second, failed attempt.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const code = params.get("code");
    const state = params.get("state");
    if (params.get("error") || !code || !state) {
      setError(t("roadtrips:strava.callbackDenied"));
      return;
    }
    stravaApi
      .exchange({ code, state, scope: params.get("scope") ?? undefined })
      .then(() => {
        addToast("success", t("roadtrips:strava.callbackDone"));
        navigate("/settings?section=externalServices", { replace: true });
      })
      .catch((err: unknown) => {
        const kind = stravaFailureKind(err);
        setError(
          kind ? t(`roadtrips:strava.failure.${kind}`) : t("roadtrips:strava.callbackFailed")
        );
      });
  }, [params, navigate, addToast, t]);

  return (
    <AppShell width="reading">
      <div className="py-16 text-center text-sm">
        {error ? (
          <>
            <p style={{ color: "var(--danger)" }}>{error}</p>
            <Link to="/settings?section=externalServices" className="mt-4 inline-block underline">
              {t("roadtrips:strava.backToSettings")}
            </Link>
          </>
        ) : (
          <p className="text-(--text-muted)">{t("roadtrips:strava.callbackWorking")}</p>
        )}
      </div>
    </AppShell>
  );
}
