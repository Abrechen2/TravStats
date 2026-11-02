import { useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import type { RemoteServer } from "../../types/sharingRemote";
import { Button } from "../ui";
import { Field, Input, Select } from "../ui/Field";

const NS = "sharing:remote.trip.otherServer";
const WARNINGS = ["warnStored", "warnEdits", "warnPrivate", "warnRecall", "warnAccept"] as const;

/**
 * "Auf anderem Server" on a trip's "Teilen" (simplified setup 2026-11-02, forgejo#301): pick one
 * of the connected servers, name the person (looked up among that server's findable users when
 * the offer is sent), read what sharing across servers means, and send the offer — the person
 * accepts it in their inbox. The warnings are always on screen before the button, not behind it.
 */
export default function RemoteOtherServerOffer({
  busy,
  onOffer,
}: {
  busy: boolean;
  /** Resolves true when the offer went out, so the name is kept for a retry otherwise. */
  onOffer: (origin: string, username: string) => Promise<boolean>;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const [servers, setServers] = useState<RemoteServer[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [origin, setOrigin] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    let cancelled = false;
    sharingRemoteApi.listServers().then(
      (list) => {
        if (cancelled) return;
        setServers(list);
        setOrigin((current) => current || list[0]?.origin || "");
      },
      (error: unknown) => {
        logger.error("Failed to load the connected servers:", error);
        if (!cancelled) setLoadFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const name = username.trim();
    if (!origin || !name) return;
    void onOffer(origin, name).then((sent) => {
      if (sent) setUsername("");
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="remote-other-server">
      <h4 className="t-label-mono">{t(`${NS}.title`)}</h4>
      {loadFailed && (
        <p role="alert" style={{ color: "var(--ts-warn)" }}>
          {t("sharing:remote.errors.loadFailed")}
        </p>
      )}
      {servers && servers.length === 0 && <p className="t-caption">{t(`${NS}.noServers`)}</p>}
      {servers && servers.length > 0 && (
        <>
          <Field label={t(`${NS}.pick`)} htmlFor="other-server-pick">
            <Select
              id="other-server-pick"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            >
              {servers.map((s) => (
                <option key={s.origin} value={s.origin}>
                  {s.origin}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t(`${NS}.username`)} htmlFor="other-server-username">
            <Input
              id="other-server-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <div className="t-caption" data-testid="remote-other-server-warnings">
            <p className="font-medium">{t(`${NS}.warnTitle`)}</p>
            <ul className="list-disc pl-5">
              {WARNINGS.map((key) => (
                <li key={key}>{t(`${NS}.${key}`)}</li>
              ))}
            </ul>
          </div>
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !origin || username.trim() === ""}
            >
              {t(`${NS}.submit`)}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
