import { useEffect, useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import {
  encryptedShareGet,
  encryptedSharePost,
  type Circle,
  type Link,
} from "../../lib/api/encryptedShare";
export default function SealedGroups({
  links,
  onOpen,
}: {
  links: Link[];
  onOpen: (circle: Circle) => void;
}) {
  const { t } = useTranslation("encryptedShare");
  const [circles, setCircles] = useState<Circle[]>([]),
    [name, setName] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const load = async () => setCircles(await encryptedShareGet<Circle[]>("/circles"));
  useEffect(() => {
    void load().catch(() => setError(true));
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(false);
    try {
      await fn();
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-5">
      <p>{t("e2e.groupHelp")}</p>
      {error && <p role="alert">{t("error")}</p>}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => encryptedSharePost("/circles", { name, linkIds: ids }));
        }}
      >
        <label>
          {t("circleName")}
          <input required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        {links
          .filter((l) => l.confirmed && l.remoteConfirmed)
          .map((l) => (
            <label key={l.id} className="block">
              <input
                type="checkbox"
                checked={ids.includes(l.id)}
                onChange={(e) =>
                  setIds(e.target.checked ? [...ids, l.id] : ids.filter((id) => id !== l.id))
                }
              />
              {l.label}
            </label>
          ))}
        <Button type="submit" disabled={busy || !ids.length || ids.length > 19}>
          {t("createCircle")}
        </Button>
      </form>
      {circles.map((c) => (
        <article
          key={`${c.id}:${c.linkId}`}
          className="rounded-xl border border-[var(--ts-border)] p-4 space-y-3"
        >
          <h3>
            {c.name} · {c.members.length + 1} · v{c.version}
          </h3>
          <p>{c.host}</p>
          <Button disabled={busy} onClick={() => onOpen(c)}>
            {t("e2e.openGroup")}
          </Button>
          <ul>
            {c.members.map((m) => (
              <li key={m.channel}>
                {m.label} · {m.origin}{" "}
                {!c.linkId && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        encryptedSharePost("/circles/remove", {
                          circleId: c.id,
                          channel: m.channel,
                        })
                      )
                    }
                  >
                    {t("removeMember")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!c.linkId && (
            <label>
              {t("addMember")}
              <select
                value=""
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value)
                    void run(() =>
                      encryptedSharePost("/circles/add", { circleId: c.id, linkId: e.target.value })
                    );
                }}
              >
                <option value="">—</option>
                {links
                  .filter(
                    (l) =>
                      l.confirmed &&
                      l.remoteConfirmed &&
                      !c.members.some((m) => m.channel === l.channel)
                  )
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {c.linkId && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  encryptedSharePost("/circles/leave", {
                    circleId: c.id,
                    linkId: c.linkId,
                    version: c.version,
                  })
                )
              }
            >
              {t("leaveCircle")}
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}
