import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";
import { useTranslation } from "../hooks/useTranslation";
import { useAuthStore } from "../store/authStore";
import { decodeInvitePayload } from "../lib/comparison/inviteLink";

const HOME_SERVER_KEY = "travstats.friends.homeServer";

/** The remembered server of the reader; storage may be blocked or empty, and that is fine. */
function rememberedServer(): string {
  try {
    return window.localStorage.getItem(HOME_SERVER_KEY) ?? "";
  } catch {
    return "";
  }
}
function remember(origin: string): void {
  try {
    window.localStorage.setItem(HOME_SERVER_KEY, origin);
  } catch {
    // A blocked store only means the field is empty next time.
  }
}
/** `friends.example`, `https://friends.example/` or with a path: the bare origin, or null. */
function serverOrigin(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * /freunde/einladung (spec 2026-11-07 §6.3, §9.5): the landing page of an invitation link. A
 * static client page — it reads the URL fragment and sends nothing, so it needs no session and no
 * beta flag. A stranger types their own server and is sent on to ITS /freunde/annehmen; the
 * inviter's server never learns where, and never sees the friend's session.
 */
export default function FriendInvitePage(): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const user = useAuthStore((s) => s.user);
  const [raw] = useState(() => window.location.hash.replace(/^#/, ""));
  const [server, setServer] = useState(rememberedServer);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const decoded = decodeInvitePayload(raw);
  const origin = serverOrigin(server);

  const go = (): void => {
    if (!origin) return;
    remember(origin);
    window.location.assign(`${origin}/freunde/annehmen#${raw}`);
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <main
      className="mx-auto flex max-w-xl flex-col px-4 py-12"
      style={{ gap: "var(--ts-space-xl)" }}
    >
      <PageHeader title={tr("friends.invite.title")} />
      {!decoded.ok ? (
        <Card>
          <p role="alert">{tr("friends.accept.damaged")}</p>
          <p className="t-caption">{tr("friends.accept.damagedHint")}</p>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
            {/* A session here only means this is the inviter's server, not the reader's own. */}
            {user && (
              <p>
                {tr("friends.invite.ownServer")}{" "}
                <Link to="/freunde">{tr("friends.invite.toFriends")}</Link>
              </p>
            )}
            <p>{tr("friends.invite.intro", { origin: decoded.payload.origin })}</p>
            <Field
              label={tr("friends.invite.serverLabel")}
              htmlFor="friends-home-server"
              hint={tr("friends.invite.serverHint")}
              error={server.trim() && !origin ? tr("friends.invite.serverInvalid") : undefined}
            >
              <Input
                id="friends-home-server"
                value={server}
                invalid={Boolean(server.trim()) && !origin}
                onChange={(e) => setServer(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
              <Button disabled={!origin} onClick={go}>
                {tr("friends.invite.open")}
              </Button>
              <Button variant="secondary" onClick={() => void copy()}>
                {tr(copied === "done" ? "add.copied" : "friends.invite.copy")}
              </Button>
            </div>
            {copied === "failed" && <p role="status">{tr("add.copyFailed")}</p>}
          </div>
        </Card>
      )}
    </main>
  );
}
