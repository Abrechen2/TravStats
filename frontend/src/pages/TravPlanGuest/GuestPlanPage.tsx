import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Button, Card, EmptyState } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { downloadBlob } from "../../lib/export";
import { GUEST_ENDED_EVENT, setGuestSession } from "../../lib/api/guestHttp";
import { travplanGuestsApi, type GuestSessionInfo } from "../../lib/api/travplanGuests";
import PlanContent, { PLAN_SECTIONS } from "../TravPlan/PlanContent";
import { PlanActions, PlanNotice } from "../TravPlan/planLayout";
import { GuestFrame } from "./GuestFrame";
import { guestErrorKey } from "./guestErrors";

/**
 * What the Companion scans in-app (it is no URL, so the OS opens nothing and a screenshot holds
 * only a code that works once, for five minutes): the host, the one plan and a claim code.
 */
export const phonePayload = (
  host: string,
  planId: string,
  code: string,
  hostName: string
): string => JSON.stringify({ v: 1, k: "guest", u: host, p: planId, c: code, n: hostName });

const minutesLeft = (expiresAt: string, now = Date.now()): number =>
  Math.max(1, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));

/**
 * Guest mode (spec 2026-10-17 §6.5 step 5): the host's own plan screens for a person from another
 * server. The header says whose server this is and that they are a guest; there is no other
 * navigation. While this page is mounted the plan's API calls go through the guest door.
 */
export default function GuestPlanPage() {
  const { t } = useTranslation("travplan");
  const { tripId = "", section = "overview" } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<GuestSessionInfo | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [phone, setPhone] = useState<{ payload: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const onEnded = (e: Event) => {
      const code = (e as CustomEvent<{ code?: string }>).detail?.code;
      if (live) setEnded(code ?? "PLAN_GUEST_REQUIRED");
    };
    window.addEventListener(GUEST_ENDED_EVENT, onEnded);
    travplanGuestsApi
      .session()
      .then((next) => {
        if (!live) return;
        setGuestSession({ planId: next.planId, tripId: next.tripId });
        setInfo(next);
      })
      .catch((cause: unknown) => {
        if (live)
          setEnded(
            (cause as { response?: { data?: { code?: string } } })?.response?.data?.code ??
              "PLAN_GUEST_REQUIRED"
          );
      });
    return () => {
      live = false;
      window.removeEventListener(GUEST_ENDED_EVENT, onEnded);
      setGuestSession(null);
    };
  }, []);
  const leave = useCallback(async () => {
    try {
      await travplanGuestsApi.leave();
      navigate("/login", { replace: true });
    } catch (cause) {
      setError(t(guestErrorKey(cause), { defaultValue: t("errors.unknown") }));
    }
  }, [navigate, t]);
  const saveTrip = useCallback(
    async (planId: string) => {
      try {
        const file = await travplanGuestsApi.exportTrip(planId);
        downloadBlob(file.blob, file.filename);
        setError("");
      } catch (cause) {
        setError(t(guestErrorKey(cause), { defaultValue: t("guests.exportFailed") }));
      }
    },
    [t]
  );
  if (ended)
    return (
      <GuestFrame>
        <EmptyState
          kind="degraded"
          title={t("guests.ended.title")}
          description={t(
            ended === "PLAN_GUEST_EXPIRED" ? "errors.PLAN_GUEST_EXPIRED" : "errors." + ended,
            { defaultValue: t("guests.ended.body") }
          )}
          action={<Link to="/login">{t("guests.ended.toLogin")}</Link>}
        />
      </GuestFrame>
    );
  if (!info || info.tripId !== tripId)
    return (
      <GuestFrame>
        <EmptyState kind="pending" title={t("loading")} />
      </GuestFrame>
    );
  return (
    <GuestFrame wide>
      <Card>
        <p className="t-caption">
          {t("guests.banner", { host: window.location.host, name: info.displayName })}
        </p>
        <PlanActions>
          {info.credential === "session" && (
            <Button
              onClick={() =>
                void travplanGuestsApi
                  .pairingCode(info.planId)
                  .then((claim) =>
                    setPhone({
                      payload: phonePayload(
                        window.location.origin,
                        info.planId,
                        claim.code,
                        info.hostName
                      ),
                      expiresAt: claim.expiresAt,
                    })
                  )
                  .catch((cause: unknown) =>
                    setError(t(guestErrorKey(cause), { defaultValue: t("errors.unknown") }))
                  )
              }
            >
              {t("guests.phone.open")}
            </Button>
          )}
          <Button onClick={() => void saveTrip(info.planId)}>{t("guests.export")}</Button>
          <Button variant="danger" onClick={() => void leave()}>
            {t("guests.leave")}
          </Button>
        </PlanActions>
        {phone && (
          <div>
            <QRCodeSVG value={phone.payload} size={192} />
            <p className="t-caption">{t("guests.phone.hint")}</p>
            <p className="t-caption">
              {t("guests.phone.expires", { minutes: minutesLeft(phone.expiresAt) })}
            </p>
          </div>
        )}
        <p className="t-caption">{t("guests.exportHint")}</p>
        {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      </Card>
      <PlanContent
        key={tripId}
        tripId={tripId}
        guest
        section={PLAN_SECTIONS.includes(section) ? section : "overview"}
      />
    </GuestFrame>
  );
}
