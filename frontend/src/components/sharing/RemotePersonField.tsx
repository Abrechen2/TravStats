import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingConnectionsApi } from "../../lib/api/sharingConnections";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import { NO_SWITCHES } from "../../types/sharingRemote";
import { Button } from "../ui";
import { Field, Input } from "../ui/Field";
import { remoteSharingError } from "./remoteSharingCopy";

const NS = "sharing:remote.trip.person";
const WARNINGS = ["warnStored", "warnEdits", "warnPrivate", "warnRecall", "warnAccept"] as const;

/** `user@server` or `user@https://server`; the last `@` splits, so a name may contain one. */
export function parsePersonAddress(raw: string): { origin: string; username: string } | null {
  const text = raw.trim();
  const at = text.lastIndexOf("@");
  if (at < 1) return null;
  const username = text.slice(0, at).trim();
  let host = text
    .slice(at + 1)
    .trim()
    .replace(/\/+$/, "");
  if (!username || !host) return null;
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  try {
    const url = new URL(host);
    return { origin: url.origin.toLowerCase(), username };
  } catch {
    return null;
  }
}

type Outcome =
  { kind: "working" } | { kind: "ok" | "warn"; key: string; origin?: string; name?: string };

/**
 * ONE free field for a person on another server (owner, 2026-11-20): `user@server`. It walks the
 * existing chain and says where it stopped: the server must be admitted (an admin's step — the
 * invitation code is the way around it, behind the small link below); the person needs a
 * connection (`POST /sharing/connections`, trip offers only — they confirm it in their inbox);
 * with a confirmed connection the trip is offered (`onOffer`), and the person answers in theirs.
 * Nothing here pairs or admits on its own.
 */
export default function RemotePersonField({
  busy,
  onOffer,
  onCreateCode,
}: {
  busy: boolean;
  /** Resolves true when the offer went out; the caller says a refusal itself. */
  onOffer: (origin: string, username: string) => Promise<boolean>;
  onCreateCode: () => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const [value, setValue] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const working = outcome?.kind === "working";

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const person = parsePersonAddress(value);
    if (!person) {
      setOutcome({ kind: "warn", key: "invalid" });
      return;
    }
    const { origin, username } = person;
    setOutcome({ kind: "working" });
    try {
      const servers = await sharingRemoteApi.listServers();
      if (!servers.some((s) => s.origin.toLowerCase().replace(/\/+$/, "") === origin)) {
        setOutcome({ kind: "warn", key: "serverNotConnected", origin });
        return;
      }
      const known = (await sharingConnectionsApi.list()).find(
        (c) => c.origin.toLowerCase() === origin && c.username === username
      );
      if (known?.state === "active") {
        setOutcome({ kind: "working" });
        const sent = await onOffer(origin, username);
        setOutcome(null);
        if (sent) setValue("");
        return;
      }
      if (known?.state === "pending_out") {
        setOutcome({ kind: "ok", key: "waiting", name: username, origin });
        return;
      }
      await sharingConnectionsApi.request(origin, username, { ...NO_SWITCHES, tripOffers: true });
      setOutcome({ kind: "ok", key: "requested", name: username, origin });
      setValue("");
    } catch (error) {
      logger.error("Reaching a person on another server failed:", error);
      const failure = remoteSharingError(error, `${NS}.failed`);
      setOutcome({ kind: "warn", key: `raw:${failure.key}`, origin: failure.origin || origin });
    }
  };

  const message = ((): string | null => {
    if (!outcome || outcome.kind === "working") return null;
    const vars = { origin: outcome.origin ?? "", name: outcome.name ?? "" };
    return outcome.key.startsWith("raw:")
      ? t(outcome.key.slice(4), vars)
      : t(`${NS}.${outcome.key}`, vars);
  })();

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2"
      data-testid="remote-person-field"
    >
      <Field
        label={t(`${NS}.label`)}
        htmlFor="remote-person-field"
        hint={
          <>
            {t(`${NS}.hint`)}{" "}
            <button type="button" className="underline" disabled={busy} onClick={onCreateCode}>
              {t(`${NS}.codeLink`)}
            </button>
          </>
        }
      >
        <Input
          id="remote-person-field"
          value={value}
          placeholder={t(`${NS}.placeholder`)}
          onChange={(e) => setValue(e.target.value)}
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
        <Button type="submit" variant="primary" disabled={busy || working || value.trim() === ""}>
          {working ? t(`${NS}.working`) : t(`${NS}.submit`)}
        </Button>
      </div>
      {message && (
        <p
          role={outcome?.kind === "warn" ? "alert" : "status"}
          data-testid="remote-person-outcome"
          style={outcome?.kind === "warn" ? { color: "var(--ts-warn)" } : undefined}
        >
          {message}
        </p>
      )}
    </form>
  );
}
