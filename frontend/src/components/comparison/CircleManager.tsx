import { useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { Button } from "../ui";
import {
  comparisonGet,
  comparisonPost,
  type Link,
  type Circle,
  type Snapshot,
} from "../../lib/api/comparison";
import { initialScope } from "./GrantEditor";
import { rankRows, type ComparisonRow } from "./ranking";
export default function CircleManager({ links, domains }: { links: Link[]; domains: string[] }) {
  const { t } = useTranslation("comparison");
  const [circles, setCircles] = useState<Circle[]>([]),
    [name, setName] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [selected, setSelected] = useState<Circle | null>(null),
    [approved, setApproved] = useState(false),
    [rows, setRows] = useState<ComparisonRow[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const [year, setYear] = useState<number | null>(new Date().getUTCFullYear());
  const load = () =>
    comparisonGet<Circle[]>("/circles").then((list) => {
      setCircles(list);
      setSelected((current) =>
        current
          ? (list.find((c) => c.id === current.id && c.linkId === current.linkId) ?? null)
          : null
      );
    });
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
      setRows([]);
    } finally {
      setBusy(false);
    }
  };
  const payload = (c: Circle) => ({ circleId: c.id, version: c.version, linkId: c.linkId });
  const read = async (c: Circle) => {
    const result = await comparisonPost<{
      rows: Array<{ channel: string; label: string; snapshot: Snapshot | null }>;
    }>("/circles/read", { ...payload(c), year });
    setRows(result.rows.map((r) => ({ id: r.channel, label: r.label, snapshot: r.snapshot })));
  };
  return (
    <section className="space-y-5">
      <h2 className="text-xl font-bold">{t("circles")}</h2>
      <p>{t("circleHelp")}</p>
      {error && <p role="alert">{t("error")}</p>}
      <form
        className="rounded-xl border p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await comparisonPost("/circles", { name, linkIds: ids });
            setName("");
            setIds([]);
          });
        }}
      >
        <label>
          {t("circleName")}
          <input required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        {links
          .filter((l) => l.confirmed && l.remoteConfirmed)
          .map((l) => (
            <label className="block" key={l.id}>
              <input
                type="checkbox"
                checked={ids.includes(l.id)}
                onChange={(e) =>
                  setIds(e.target.checked ? [...ids, l.id] : ids.filter((id) => id !== l.id))
                }
              />
              {l.label} · {l.origin}
            </label>
          ))}
        <p>{t("rosterDisclosure")}</p>
        <Button type="submit" disabled={busy || !ids.length || ids.length > 19}>
          {t("createCircle")}
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {circles.map((c) => (
          <Button
            key={`${c.id}:${c.linkId}`}
            onClick={() => {
              setSelected(c);
              setApproved(false);
              setRows([]);
            }}
          >
            {c.name} · {c.members.length + 1}
          </Button>
        ))}
      </div>
      {selected && (
        <article className="rounded-xl border p-5 space-y-4">
          <h3 className="text-xl font-bold">{selected.name}</h3>
          <p>
            {t("host")}: {selected.host === "local" ? t("local") : selected.host} ·{" "}
            {t("rosterVersion", { version: selected.version })}
          </p>
          <ul>
            {selected.members.map((m) => (
              <li key={m.channel} className="flex flex-wrap gap-3 items-center py-1">
                <span>
                  {m.label} · {m.origin} · {t(m.accepted ? "accepted" : "pending")}
                </span>
                {!selected.linkId && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await comparisonPost("/circles/remove", {
                          circleId: selected.id,
                          channel: m.channel,
                        });
                        setSelected(null);
                      })
                    }
                  >
                    {t("removeMember")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!selected.linkId && (
            <div className="flex flex-wrap gap-2">
              {links
                .filter(
                  (l) =>
                    l.confirmed &&
                    l.remoteConfirmed &&
                    !selected.members.some((m) => m.channel === l.channel)
                )
                .map((l) => (
                  <Button
                    key={l.id}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await comparisonPost("/circles/add", {
                          circleId: selected.id,
                          linkId: l.id,
                        });
                        setApproved(false);
                        setRows([]);
                      })
                    }
                  >
                    {t("addMember")}: {l.label}
                  </Button>
                ))}
            </div>
          )}
          <p>{t("circleConsent")}</p>
          <p>{t("disclosure")}</p>
          <label className="block">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            {t("circleApprove")}
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              disabled={busy || !approved}
              onClick={() =>
                void run(() =>
                  comparisonPost("/circles/grant", {
                    ...payload(selected),
                    scope: { ...initialScope(domains), statistics: true, futureTrips: true },
                  })
                )
              }
            >
              {t("shareGroupStats")}
            </Button>
            {selected.linkId && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await comparisonPost("/circles/leave", payload(selected));
                    setSelected(null);
                  })
                }
              >
                {t("leaveCircle")}
              </Button>
            )}
          </div>
          <label>
            {t("year")}
            <input
              type="number"
              min={1900}
              max={2200}
              value={year ?? ""}
              placeholder={t("lifetime")}
              onChange={(e) => {
                setYear(e.target.value ? Number(e.target.value) : null);
                setRows([]);
              }}
            />
          </label>
          <Button disabled={busy} onClick={() => void run(() => read(selected))}>
            {t("showCircle")}
          </Button>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  {["rank", "person", "flights", "distance", "countries", "daysAway"].map((h) => (
                    <th className="p-3" key={h}>
                      {t(["rank", "person"].includes(h) ? h : `metric.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankRows(rows, "distance", year).map((r) => (
                  <tr key={r.id}>
                    <td className="p-3">{r.rank ?? "—"}</td>
                    <th className="p-3">{r.id === "host" ? t("hostPerson") : r.label}</th>
                    {(["flights", "distance", "countries", "daysAway"] as const).map((m) => (
                      <td className="p-3" key={m}>
                        {r.snapshot?.metrics[m] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
}
