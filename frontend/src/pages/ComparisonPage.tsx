import "../components/comparison/comparison.css";
import { Navigate } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import RecordBrowser from "../components/comparison/RecordBrowser";
import { COMPARISON_METRICS } from "../lib/api/comparison";
import CircleManager from "../components/comparison/CircleManager";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, Button, PageHeader } from "../components/ui";
import { useTranslation } from "../hooks/useTranslation";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useAuthStore } from "../store/authStore";
import {
  comparisonGet,
  comparisonPost,
  type Link,
  type Snapshot,
  type Detail,
  type Board,
} from "../lib/api/comparison";
import { rankRows, type ComparisonRow, type Metric } from "../components/comparison/ranking";
import FriendManager from "../components/comparison/FriendManager";
import GrantEditor, { initialScope } from "../components/comparison/GrantEditor";
import PeerManager from "../components/comparison/PeerManager";

export default function ComparisonPage() {
  const user = useAuthStore((s) => s.user);
  return user ? (
    <BetaFeatureRouteGuard feature="comparison" redirectTo="/dashboard">
      <ComparisonContent />
    </BetaFeatureRouteGuard>
  ) : (
    <Navigate to="/login" />
  );
}

function ComparisonContent() {
  const { t, i18n } = useTranslation("comparison");
  const { enabled } = useEnabledDomains();
  const user = useAuthStore((s) => s.user);
  const [links, setLinks] = useState<Link[]>([]),
    [trips, setTrips] = useState<Array<{ id: string; name: string }>>([]),
    [boards, setBoards] = useState<Board[]>([]);
  const [tab, setTab] = useState("leaderboard"),
    [board, setBoard] = useState(""),
    [year, setYear] = useState<number | null>(new Date().getUTCFullYear()),
    [metric, setMetric] = useState<Metric>("distance");
  const [rows, setRows] = useState<ComparisonRow[]>([]),
    [grant, setGrant] = useState<Link | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState<ComparisonRow | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [audit, setAudit] = useState<Array<{ channel: string; operation: string; createdAt: string }>>(
      []
    );
  const [boardName, setBoardName] = useState(""),
    [boardChannels, setBoardChannels] = useState<string[]>([]);
  const generation = useRef(0);
  const load = useCallback(async () => {
    try {
      const [l, tr, b] = await Promise.all([
        comparisonGet<Link[]>("/links"),
        comparisonGet<typeof trips>("/trips"),
        comparisonGet<Board[]>("/boards"),
      ]);
      setLinks(l);
      setTrips(tr);
      setBoards(b);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    setBusy(true);
    setError(false);
    setRows([]);
    setSelected(null);
    setDetail(null);
    const filter = boards.find((b) => b.id === board);
    const active = links.filter(
      (l) => l.confirmed && l.remoteConfirmed && (!filter || filter.channels.includes(l.channel))
    );
    try {
      const mine = await comparisonPost<Snapshot>("/preview", {
        ...initialScope(enabled),
        statistics: true,
        costs: true,
        futureTrips: true,
        year,
      });
      const others: ComparisonRow[] = [];
      // Bound fan-out: one remote peer request at a time, with a cancellation epoch for UI changes.
      for (const link of active) {
        if (token !== generation.current) return;
        try {
          others.push({
            id: link.id,
            label: link.label,
            snapshot: await comparisonPost<Snapshot>(`/links/${link.id}/read`, {
              audience: "",
              year,
            }),
          });
        } catch {
          others.push({ id: link.id, label: link.label, snapshot: null, error: true });
        }
      }
      if (token === generation.current)
        setRows([{ id: "self", label: t("you"), snapshot: mine }, ...others]);
    } catch {
      if (token === generation.current) setError(true);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }, [board, boards, enabled, links, t, year]);
  useEffect(() => {
    if (tab === "leaderboard") void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, tab]);
  const ranked = rankRows(
    rows,
    metric,
    year,
    rows.find((r) => r.id === "self")?.snapshot?.currency
  );
  const columns: Metric[] = Array.from(
    new Set<Metric>(["flights", "distance", "countries", "daysAway", metric])
  );
  const showDetails = async (row: ComparisonRow, tripId: string) => {
    setBusy(true);
    setError(false);
    try {
      setDetail(
        await comparisonPost<Detail>(`/links/${row.id}/read`, { audience: "", year, tripId })
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const downloadAttachment = async (key: string) => {
    if (!selected || !detail) return;
    setBusy(true);
    setError(false);
    try {
      const file = await comparisonPost<{ name: string; bytes: string; mime: string }>(
        `/links/${selected.id}/read`,
        { audience: "", year, tripId: detail.tripId, attachment: key }
      );
      const bytes = Uint8Array.from(atob(file.bytes), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/[\\/]/g, "_");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const format = (n: number | null) =>
    n === null ? "—" : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(n);
  return (
    <AppShell width="table" className="comparison-surface">
      <PageHeader
        title={t("title")}
        meta={t("subtitle")}
        actions={<Button onClick={() => setTab("friends")}>{t("connect")}</Button>}
      />
      <nav className="flex flex-wrap gap-2 mb-6" aria-label={t("views")}>
        {[
          "leaderboard",
          "friends",
          "circles",
          "boards",
          "audit",
          ...(user?.isAdmin ? ["peers"] : []),
        ].map((key) => (
          <Button
            key={key}
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => {
              setTab(key);
              if (key === "audit")
                void comparisonGet<typeof audit>("/audit")
                  .then(setAudit)
                  .catch(() => setError(true));
            }}
          >
            {t(key)}
          </Button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="mb-4">
          {t("error")}
        </p>
      )}
      {!enabled.length && <p>{t("noDomains")}</p>}
      {tab === "friends" && (
        <div className="space-y-6">
          <FriendManager links={links} onChange={() => void load()} onGrant={setGrant} />
          {grant && (
            <GrantEditor
              key={grant.id}
              link={grant}
              domains={enabled}
              trips={trips}
              onClose={() => setGrant(null)}
              onSaved={() => {
                setGrant(null);
                void load();
              }}
            />
          )}
        </div>
      )}
      {tab === "peers" && user?.isAdmin && <PeerManager />}
      {tab === "circles" && <CircleManager links={links} domains={enabled} />}
      {tab === "boards" && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">{t("boards")}</h2>
          <p>{t("boardHelp")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void comparisonPost("/boards", { name: boardName, channels: boardChannels })
                .then(() => {
                  setBoardName("");
                  setBoardChannels([]);
                  void load();
                })
                .catch(() => setError(true))
                .finally(() => setBusy(false));
            }}
            className="space-y-3"
          >
            <label>
              {t("boardName")}
              <input
                required
                maxLength={80}
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
              />
            </label>
            {links
              .filter((l) => l.confirmed && l.remoteConfirmed)
              .map((l) => (
                <label className="block" key={l.id}>
                  <input
                    type="checkbox"
                    checked={boardChannels.includes(l.channel)}
                    onChange={(e) =>
                      setBoardChannels(
                        e.target.checked
                          ? [...boardChannels, l.channel]
                          : boardChannels.filter((c) => c !== l.channel)
                      )
                    }
                  />
                  {l.label}
                </label>
              ))}
            <Button type="submit" disabled={busy || boardChannels.length > 20}>
              {t("saveBoard")}
            </Button>
          </form>
          <ul>
            {boards.map((b) => (
              <li key={b.id}>
                {b.name} · {b.channels.length}
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === "audit" && (
        <section>
          <p>{t("auditHelp")}</p>
          <ul className="divide-y">
            {audit.map((a, i) => (
              <li key={i} className="py-3">
                {links.find((l) => l.channel === a.channel)?.label ?? t("formerFriend")} ·{" "}
                {t(`operation.${a.operation}`)} · {a.createdAt}
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === "leaderboard" && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <label>
              {t("board")}
              <select value={board} onChange={(e) => setBoard(e.target.value)}>
                <option value="">{t("myFriends")}</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("year")}
              <input
                aria-label={t("year")}
                type="number"
                min={1900}
                max={2200}
                placeholder={t("lifetime")}
                value={year ?? ""}
                onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
            <label>
              {t("rankBy")}
              <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                {COMPARISON_METRICS.map((m) => (
                  <option value={m} key={m}>
                    {t(`metric.${m}`)}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={busy} onClick={() => void refresh()}>
              {t("refresh")}
            </Button>
          </div>
          <p className="text-sm text-[var(--ts-text-muted)]">{t("privateBoard")}</p>
          {busy && <p role="status">{t("loading")}</p>}
          <div className="overflow-x-auto rounded-2xl border border-[var(--ts-border)]">
            <table className="w-full min-w-[720px] text-left">
              <caption className="sr-only">{t("leaderboard")}</caption>
              <thead>
                <tr className="border-b bg-[var(--ts-surface)]">
                  {["rank", "person", ...columns].map((h) => (
                    <th className="p-4" scope="col" key={h}>
                      {t(["rank", "person"].includes(h) ? h : `metric.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="p-4 font-bold">{row.rank ?? "—"}</td>
                    <th scope="row" className="p-4">
                      <button
                        className="text-left underline"
                        onClick={() => {
                          setSelected(row);
                          setDetail(null);
                        }}
                      >
                        {row.label}
                      </button>
                      <p className="text-xs font-normal">
                        {row.snapshot
                          ? `${t("updated")} ${row.snapshot.asOf.slice(0, 16).replace("T", " ")} UTC`
                          : t("notShared")}
                      </p>
                      {row.snapshot?.coverage === "selection" && (
                        <span className="text-xs">{t("selection")}</span>
                      )}
                    </th>
                    {columns.map((m) => (
                      <td key={m} className="p-4 tabular-nums">
                        {row.snapshot?.precision === "rounded" && m === "distance" ? "≥ " : ""}
                        {format(row.snapshot?.metrics[m] ?? null)}
                        {m === "distance" && row.snapshot?.metrics.distance !== null && row.snapshot
                          ? " km"
                          : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!links.length && !busy && <p>{t("empty")}</p>}
          <p className="text-sm">{t("rankingHelp")}</p>
          {selected && (
            <section className="rounded-2xl border p-5 space-y-3">
              <h2 className="text-xl font-bold">{selected.label}</h2>
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {Object.entries(selected.snapshot?.metrics ?? {}).map(([key, value]) => (
                  <div key={key}>
                    <dt>{t(`metric.${key}`)}</dt>
                    <dd className="text-xl">
                      {format(value)} {key === "cost" ? selected.snapshot?.currency : ""}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.id !== "self" && selected.snapshot?.details && (
                <div className="flex flex-wrap gap-2">
                  {selected.snapshot.trips.map((trip) => (
                    <Button
                      key={trip.id}
                      disabled={busy}
                      onClick={() => void showDetails(selected, trip.id)}
                    >
                      {trip.name}
                    </Button>
                  ))}
                </div>
              )}
              {selected.id !== "self" && selected.snapshot?.details && (
                <RecordBrowser
                  key={selected.id}
                  linkId={selected.id}
                  domains={selected.snapshot.domains}
                  year={year}
                />
              )}
              {detail && (
                <div>
                  <div className="flex flex-wrap gap-2">
                    {detail.attachments.map((a) => (
                      <Button
                        key={a.key}
                        disabled={busy}
                        onClick={() => void downloadAttachment(a.key)}
                      >
                        {t("download")}: {a.name}
                      </Button>
                    ))}
                  </div>
                  {detail.sections.map((section) => (
                    <section key={section.name} className="my-4">
                      <h3 className="font-bold">{t(`section.${section.name}`)}</h3>
                      {section.rows.map((row) => (
                        <dl
                          key={row.key}
                          className="grid grid-cols-2 md:grid-cols-3 gap-2 border-t py-3"
                        >
                          {row.fields.map((field) => (
                            <div key={field.name}>
                              <dt className="text-xs text-[var(--ts-text-muted)]">
                                {t(`field.${field.name.split(".").slice(-1)[0]}`)}
                              </dt>
                              <dd className="break-words whitespace-pre-wrap">
                                {field.value === null ? "—" : String(field.value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </section>
          )}
        </section>
      )}
    </AppShell>
  );
}
