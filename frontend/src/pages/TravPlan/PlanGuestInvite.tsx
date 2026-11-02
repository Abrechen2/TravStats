import { useEffect, useState } from "react";
import { Button, Field, Input, Select } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { travplanGuestsApi, type GuestInvite } from "../../lib/api/travplanGuests";
import { guestErrorKey } from "../TravPlanGuest/guestErrors";
import { PlanActions, PlanNotice } from "./planLayout";

/**
 * Owner: invite a person on a connected server (spec 2026-10-17 §6.5 step 1). The servers are the
 * ones the admin pinned and verified (the same list "Personen auf verbundenen Servern" uses); the
 * username is only a label. The answer is a link to send by any channel, shown once.
 */
export function PlanGuestInvite({
  tripId,
  onChanged,
}: {
  tripId: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation("travplan");
  const { isFeatureVisible } = useBetaFeatures();
  const visible = isFeatureVisible("travPlanGuests");
  const [servers, setServers] = useState<string[]>([]);
  const [origin, setOrigin] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<GuestInvite | null>(null);
  useEffect(() => {
    if (!visible) return;
    sharingRemoteApi
      .listServers()
      .then((list) => {
        setServers(list.map((s) => s.origin));
        setOrigin((current) => current || list[0]?.origin || "");
      })
      .catch(() => setServers([]));
  }, [visible]);
  if (!visible) return null;
  async function send() {
    setBusy(true);
    setError("");
    try {
      setInvite(await travplanGuestsApi.invite(tripId, origin, username.trim()));
      setUsername("");
      await onChanged();
    } catch (cause) {
      setError(t(guestErrorKey(cause), { defaultValue: t("errors.unknown") }));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (origin && username.trim()) void send();
      }}
    >
      <h3 className="t-body">{t("guests.invite.title")}</h3>
      <p className="t-caption">{t("guests.invite.intro")}</p>
      {servers.length === 0 ? (
        <p className="t-caption">{t("guests.invite.noServers")}</p>
      ) : (
        <>
          <Field label={t("guests.invite.server")} htmlFor="plan-guest-server">
            <Select
              id="plan-guest-server"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            >
              {servers.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("guests.invite.username")} htmlFor="plan-guest-username">
            <Input
              id="plan-guest-username"
              value={username}
              maxLength={100}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <PlanActions>
            <Button variant="primary" type="submit" disabled={busy || !origin || !username.trim()}>
              {t("guests.invite.send")}
            </Button>
          </PlanActions>
        </>
      )}
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      {invite && (
        <PlanNotice>
          <p>{t("guests.invite.linkOnce", { name: invite.member.displayName })}</p>
          <Input
            readOnly
            aria-label={t("guests.invite.link")}
            value={invite.link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button onClick={() => void navigator.clipboard?.writeText(invite.link)}>
            {t("guests.invite.copy")}
          </Button>
        </PlanNotice>
      )}
    </form>
  );
}
