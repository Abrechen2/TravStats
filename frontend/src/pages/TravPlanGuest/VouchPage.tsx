import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Button, PageHeader } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { travplanGuestsApi } from "../../lib/api/travplanGuests";
import { clearReturn, rememberReturn } from "../../lib/postLoginReturn";
import { PlanActions, PlanNotice } from "../TravPlan/planLayout";
import { GuestFrame } from "./GuestFrame";
import { guestErrorKey } from "./guestErrors";

const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f-]{36}$/;

/** `host` must be a bare https origin; anything else is not a host this page may send a vouch to. */
export function parseVouchRequest(params: URLSearchParams) {
  const host = params.get("host") ?? "";
  const invite = params.get("invite") ?? "";
  const nonce = params.get("nonce") ?? "";
  try {
    const url = new URL(host);
    if (url.protocol !== "https:" || url.origin !== host || url.port) return null;
  } catch {
    return null;
  }
  return UUID.test(invite) && HEX64.test(nonce) ? { host, invite, nonce } : null;
}

/**
 * Step 3 of the join (spec §6.5), on the GUEST's own server: "Bei <host> als <username>
 * bestätigen?". The server signs only for a host its admin has admitted, and the vouch says who
 * the person is - this server never sees the plan.
 */
export default function VouchPage() {
  const { t } = useTranslation("travplan");
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [params] = useSearchParams();
  const request = parseVouchRequest(params);
  const [checked, setChecked] = useState<"pending" | "ok" | "failed">("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (user) clearReturn();
  }, [user]);
  useEffect(() => {
    if (!user || !request) return;
    travplanGuestsApi
      .vouchCheck(request.host)
      .then(() => setChecked("ok"))
      .catch((cause: unknown) => {
        setChecked("failed");
        setError(t(guestErrorKey(cause), { defaultValue: t("errors.unknown") }));
      });
  }, [user, request?.host]);
  if (!user) {
    rememberReturn(location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }
  async function confirm() {
    if (!request) return;
    setBusy(true);
    setError("");
    try {
      const vouched = await travplanGuestsApi.vouch(request);
      // The server already refuses a host it has not admitted; the browser checks it too.
      if (new URL(vouched.redirectUrl).origin !== request.host) throw new Error("origin");
      window.location.assign(vouched.redirectUrl);
    } catch (cause) {
      setError(t(guestErrorKey(cause), { defaultValue: t("errors.unknown") }));
      setBusy(false);
    }
  }
  return (
    <GuestFrame>
      <PageHeader title={t("guests.vouch.title")} />
      {!request ? (
        <PlanNotice tone="bad">{t("guests.vouch.invalid")}</PlanNotice>
      ) : (
        <>
          <p className="t-body">
            {t("guests.vouch.question", { host: request.host, name: user.username })}
          </p>
          <p className="t-caption">{t("guests.vouch.privacy")}</p>
        </>
      )}
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      <PlanActions>
        <Button
          variant="primary"
          disabled={!request || busy || checked !== "ok"}
          onClick={() => void confirm()}
        >
          {t("guests.vouch.confirm")}
        </Button>
        <Button disabled={busy} onClick={() => window.history.back()}>
          {t("guests.vouch.cancel")}
        </Button>
      </PlanActions>
    </GuestFrame>
  );
}
