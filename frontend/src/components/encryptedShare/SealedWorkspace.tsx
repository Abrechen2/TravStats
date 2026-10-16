import SharingOverview from "./SharingOverview";
import { useCallback, useEffect, useState } from "react";
import { AppShell, Button, PageHeader } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useAuthStore } from "../../store/authStore";
import {
  encryptedShareGet,
  COMPARISON_METRICS,
  type Link,
  type Circle,
} from "../../lib/api/encryptedShare";
import {
  audienceDevices,
  publish,
  readPublication,
  sourceData,
  ownDataView,
  type Target,
  type Audience,
} from "../../lib/encryptedShare/transport";
import type { DeviceKeys } from "../../lib/encryptedShare/crypto";
import DevicePanel from "./DevicePanel";
import KeyVerification from "./KeyVerification";
import FriendManager from "./FriendManager";
import SealedGroups from "./SealedGroups";
import GrantEditor, { initialScope } from "./GrantEditor";
import TravelComparison, { type TravelPerson } from "./TravelComparison";
import { rankRows, type Metric, type ComparisonRow } from "./ranking";
export default function SealedWorkspace() {
  const { t, i18n } = useTranslation("encryptedShare"),
    { enabled } = useEnabledDomains();
  const user = useAuthStore((s) => s.user)!;
  const [device, setDevice] = useState<DeviceKeys | null>(null),
    [links, setLinks] = useState<Link[]>([]),
    [trips, setTrips] = useState<Array<{ id: string; name: string }>>([]);
  const [tab, setTab] = useState("leaderboard"),
    [target, setTarget] = useState<Target | null>(null),
    [audience, setAudience] = useState<Audience | null>(null),
    [circle, setCircle] = useState<Circle | null>(null);
  const [shareLink, setShareLink] = useState<Link | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [notice, setNotice] = useState("");
  const [people, setPeople] = useState<TravelPerson[]>([]),
    [rows, setRows] = useState<ComparisonRow[]>([]),
    [metric, setMetric] = useState<Metric>("distance"),
    [year, setYear] = useState<number | null>(null);
  const receiveDevice = useCallback((d: DeviceKeys | null) => {
    setDevice(d);
    setPeople([]);
    setRows([]);
  }, []);
  const load = useCallback(async () => {
    const [l, tr] = await Promise.all([
      encryptedShareGet<Link[]>("/links"),
      encryptedShareGet<typeof trips>("/trips"),
    ]);
    setLinks(l);
    setTrips(tr);
  }, []);
  useEffect(() => {
    void load().catch(() => setError(true));
  }, [load]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    setNotice("");
    try {
      await fn();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const open = async (next: Target, selectedCircle: Circle | null = null) => {
    setTarget(null);
    setAudience(null);
    setCircle(selectedCircle);
    setPeople([]);
    setRows([]);
    setShareLink(null);
    setTab("sharing");
    const a = await audienceDevices(next);
    setTarget(next);
    setAudience(a);
    const link =
      links.find((l) => l.id === next.linkId) ??
      links.find((l) => a.members.some((m) => m.source === l.channel));
    if (link)
      setShareLink(
        selectedCircle
          ? {
              ...link,
              label: selectedCircle.name,
              grants: link.grants
                .filter((g) => g.audience === a.audience)
                .map((g) => ({ ...g, audience: "" })),
            }
          : link
      );
  };
  const refresh = async (groupOnly: boolean) => {
    if (!device) {
      setTab("devices");
      return;
    }
    setPeople([]);
    setRows([]);
    const mine = await sourceData({
      ...initialScope(enabled),
      statistics: true,
      details: true,
      personal: true,
      costs: true,
      documents: true,
      photos: true,
      futureTrips: true,
      year,
    });
    const nextPeople: TravelPerson[] = [
        { id: "self", label: t("you"), data: mine, opened: ownDataView(mine) },
      ],
      nextRows: ComparisonRow[] = [{ id: "self", label: t("you"), snapshot: mine.snapshot }];
    if (groupOnly && target?.circleId && audience) {
      const fresh = await audienceDevices(target);
      if (fresh.audience !== audience.audience) {
        setAudience(fresh);
        throw Error("membership changed");
      }
      for (const member of fresh.members) {
        if (member.devices.some((d) => d.fingerprint === device.public.fingerprint)) continue;
        const label = member.source === "host" ? t("hostPerson") : member.label;
        try {
          const opened = await readPublication(
            user.id,
            device,
            { ...target, audience: fresh.audience, source: member.source },
            member.devices
          );
          if (!opened) throw Error("not published");
          nextPeople.push({ id: member.source, label, data: opened.data, opened });
          nextRows.push({ id: member.source, label, snapshot: opened.data.snapshot });
        } catch {
          nextRows.push({ id: member.source, label, snapshot: null });
        }
      }
    } else {
      for (const link of links.filter((l) => l.confirmed && l.remoteConfirmed)) {
        try {
          const a = await audienceDevices({ linkId: link.id });
          const opened = await readPublication(
            user.id,
            device,
            { linkId: link.id, audience: "" },
            a.members[0].devices,
            link.channel
          );
          if (!opened) throw Error("not published");
          nextPeople.push({ id: link.id, label: link.label, data: opened.data, opened });
          nextRows.push({ id: link.id, label: link.label, snapshot: opened.data.snapshot });
        } catch {
          nextRows.push({ id: link.id, label: link.label, snapshot: null });
        }
      }
    }
    setPeople(nextPeople);
    setRows(nextRows);
  };
  const ranked = rankRows(
    rows,
    metric,
    year,
    people.find((p) => p.id === "self")?.data.snapshot.currency
  );
  return (
    <AppShell width="table" className="encrypted-share-surface">
      <PageHeader
        title={t("title")}
        meta={t("e2e.subtitle")}
        actions={<Button onClick={() => setTab("friends")}>{t("connect")}</Button>}
      />
      <nav className="flex flex-wrap gap-2 mb-6" aria-label={t("views")}>
        {["leaderboard", "friends", "circles", "sharingOverview", "devices"].map((key) => (
          <Button
            key={key}
            disabled={busy}
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => {
              setTab(key);
              setPeople([]);
              setRows([]);
            }}
          >
            {t(
              key === "devices"
                ? "e2e.devices"
                : key === "sharingOverview"
                  ? "e2e.sharingOverview"
                  : key
            )}
          </Button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="my-4">
          {t("e2e.error")}
        </p>
      )}
      {busy && (
        <p role="status">
          {t("loading")} {notice}
        </p>
      )}
      {!busy && notice && <p role="status">{notice}</p>}
      <div hidden={tab !== "devices"}>
        <DevicePanel account={user.id} onDevice={receiveDevice} />
      </div>
      {tab === "friends" && (
        <FriendManager
          links={links}
          onChange={() => void load()}
          onGrant={(l) => void run(() => open({ linkId: l.id }))}
        />
      )}
      {tab === "sharingOverview" && <SharingOverview links={links} />}
      {tab === "circles" && (
        <SealedGroups
          links={links}
          onOpen={(c) => void run(() => open({ linkId: c.linkId, circleId: c.id }, c))}
        />
      )}
      {tab === "sharing" && target && audience && (
        <section className="space-y-5">
          <h2 className="text-xl font-bold">{circle?.name ?? shareLink?.label}</h2>
          {!device ? (
            <Button onClick={() => setTab("devices")}>{t("e2e.createDevice")}</Button>
          ) : (
            <>
              <KeyVerification
                account={user.id}
                device={device}
                target={target}
                audience={audience}
                onVerified={() => setNotice(t("e2e.verified"))}
              />
              {circle && (
                <Button disabled={busy} onClick={() => void run(() => refresh(true))}>
                  {t("refresh")}
                </Button>
              )}
              {shareLink && (
                <GrantEditor
                  key={`${shareLink.id}:${audience.audience}`}
                  link={shareLink}
                  domains={enabled}
                  trips={trips}
                  onClose={() => setTab("friends")}
                  onSaved={() => {
                    setNotice(t("e2e.published"));
                    void load();
                  }}
                  onAuthorize={async (scope, data) => {
                    setBusy(true);
                    setError(false);
                    try {
                      const fresh = await audienceDevices(target);
                      if (JSON.stringify(fresh) !== JSON.stringify(audience)) {
                        setAudience(fresh);
                        throw Error("audience changed");
                      }
                      await publish(
                        user.id,
                        device,
                        links,
                        target,
                        audience,
                        scope,
                        data,
                        setNotice
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            </>
          )}
        </section>
      )}
      {(tab === "leaderboard" || tab === "sharing") && (
        <section className="space-y-5 mt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <label>
              {t("rankBy")}
              <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                {COMPARISON_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {t(`metric.${m}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("year")}
              <input
                type="number"
                min={1900}
                max={2200}
                placeholder={t("lifetime")}
                value={year ?? ""}
                onChange={(e) => {
                  setYear(e.target.value ? Number(e.target.value) : null);
                  setPeople([]);
                  setRows([]);
                }}
              />
            </label>
            <Button
              disabled={busy}
              onClick={() => void run(() => refresh(tab === "sharing" && !!circle))}
            >
              {t("refresh")}
            </Button>
          </div>
          <p>{t("e2e.freshness")}</p>
          <div className="overflow-x-auto rounded-2xl border border-[var(--ts-border)]">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr>
                  <th className="p-4">{t("rank")}</th>
                  <th className="p-4">{t("person")}</th>
                  <th className="p-4">{t(`metric.${metric}`)}</th>
                  <th className="p-4">{t("updated")}</th>
                  <th className="p-4">{t("year")}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--ts-border)]">
                    <td className="p-4">{r.rank ?? "—"}</td>
                    <th className="p-4">{r.label}</th>
                    <td className="p-4">
                      {r.snapshot?.metrics[metric] == null
                        ? "—"
                        : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(
                            r.snapshot.metrics[metric]!
                          )}
                    </td>
                    <td className="p-4">{r.snapshot?.asOf ?? t("e2e.unavailable")}</td>
                    <td className="p-4">{r.snapshot ? (r.snapshot.year ?? t("lifetime")) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>{t("rankingHelp")}</p>
          {people.length > 0 && <TravelComparison people={people} />}
        </section>
      )}
    </AppShell>
  );
}
