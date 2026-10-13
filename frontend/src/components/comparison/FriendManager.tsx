import { useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonPost, comparisonDelete, type Link } from "../../lib/api/comparison";
export default function FriendManager({
  links,
  onChange,
  onGrant,
}: {
  links: Link[];
  onChange: () => void;
  onGrant: (link: Link) => void;
}) {
  const { t } = useTranslation("comparison");
  const [invite, setInvite] = useState<{ code: string; origin: string; expiresAt: string } | null>(
    null
  );
  const [origin, setOrigin] = useState("local"),
    [code, setCode] = useState(""),
    [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [confirm, setConfirm] = useState<Link | null>(null),
    [verification, setVerification] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(false);
    try {
      await fn();
      onChange();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4" aria-label={t("friends")}>
      <div className="rounded-2xl border border-[var(--ts-border)] p-5 space-y-3">
        <h2 className="text-xl font-bold">{t("connect")}</h2>
        <Button
          disabled={busy}
          onClick={() => void run(async () => setInvite(await comparisonPost("/invites")))}
        >
          {t("createInvite")}
        </Button>
        {invite && (
          <div className="break-all rounded-xl bg-[var(--ts-surface)] p-3">
            <p>{t("inviteHelp")}</p>
            <p>{invite.origin}</p>
            <code>{invite.code}</code>
            <p>{invite.expiresAt}</p>
          </div>
        )}
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await comparisonPost("/claim", { origin, code, label });
              setCode("");
            });
          }}
        >
          <label>
            {t("server")}
            <input
              required
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label>
            {t("inviteCode")}
            <input
              required
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <label>
            {t("friendName")}
            <input
              required
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {t("acceptInvite")}
          </Button>
        </form>
      </div>
      <p>{t("e2e.revokeLimit")}</p>
      {error && <p role="alert">{t("error")}</p>}
      {links.map((link) => (
        <article
          key={link.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--ts-border)] p-4"
        >
          <div>
            <h3 className="font-bold">{link.label}</h3>
            <p className="text-sm">
              {link.origin === "local" ? t("local") : link.origin} ·{" "}
              {t(link.confirmed && link.remoteConfirmed ? "connected" : "pending")}
            </p>
            {(!link.confirmed || !link.remoteConfirmed) && (
              <p>
                {t("comparisonCode")}: <strong>{link.code}</strong>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!link.confirmed && (
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirm(link);
                  setLabel(link.label);
                  setVerification("");
                }}
              >
                {t("confirm")}
              </Button>
            )}
            {link.confirmed && link.remoteConfirmed && (
              <>
                <Button onClick={() => onGrant(link)}>{t("permissions")}</Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() => comparisonPost(`/links/${link.id}/revoke`, { audience: "" }))
                  }
                >
                  {t("revoke")}
                </Button>
              </>
            )}
            <Button
              disabled={busy}
              onClick={() => void run(() => comparisonDelete(`/links/${link.id}`))}
            >
              {t("disconnect")}
            </Button>
          </div>
        </article>
      ))}
      {confirm && (
        <form
          className="rounded-xl border p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await comparisonPost(`/links/${confirm.id}/confirm`, { label, code: verification });
              setConfirm(null);
            });
          }}
        >
          <p>{t("verifyHelp")}</p>
          <label>
            {t("friendName")}
            <input required value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            {t("comparisonCode")}
            <input
              required
              pattern="[0-9]{6}"
              inputMode="numeric"
              value={verification}
              onChange={(e) => setVerification(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {t("confirm")}
          </Button>
          <Button onClick={() => setConfirm(null)}>{t("close")}</Button>
        </form>
      )}
    </section>
  );
}
