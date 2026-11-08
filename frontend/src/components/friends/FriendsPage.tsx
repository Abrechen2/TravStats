import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { AppShell, Button, Chip, EmptyState, Field, PageHeader, Select } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS, type DomainKey } from "../../shared/domains";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import { achievementsApi } from "../../lib/api/achievements";
import { friendsApi, friendsErrorKey } from "../../lib/api/friends";
import type { CompareResponse, PeopleResponse } from "../../lib/comparison/types";
import type { FriendsResponse } from "../../lib/friends/types";
import type { Achievement } from "../../types";
import { recentYears } from "../../lib/comparison/years";
import { logger } from "../../lib/logger";
import BoardsSection from "../comparison/BoardsSection";
import AddFriendDialog from "./AddFriendDialog";
import FriendPanel from "./FriendPanel";
import FriendPicker, { MAX_PICKED } from "./FriendPicker";
import RequestsSection from "./RequestsSection";

/**
 * /freunde (spec 2026-11-08 §11.5): requests to answer, the friends to pick, then one panel per
 * picked friend. A friend is one connection; the page reads `/friends` for who and which switches,
 * `/comparison/compare` for the figures. The server builds every figure under the grant each side
 * gave; the page only lays them out.
 */
export default function FriendsPage(): JSX.Element {
  const { t } = useTranslation(["comparison", "common", "achievements"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const { enabled, isEnabled } = useEnabledDomains();
  const zone = useSettingsStore((s) => s.display.timezone);
  const years = useMemo(() => recentYears(zone), [zone]);

  const [list, setList] = useState<FriendsResponse | null>(null);
  const [listFailed, setListFailed] = useState(false);
  // Groups still come from the comparison API; losing them never hides the friends.
  const [boards, setBoards] = useState<PeopleResponse | null>(null);
  const [catalogue, setCatalogue] = useState<Achievement[] | null>(null);
  const [version, setVersion] = useState(0);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [domains, setDomains] = useState<ReadonlySet<DomainKey> | null>(null);
  const [board, setBoard] = useState("");
  const [loaded, setLoaded] = useState<{ query: string; data: CompareResponse } | null>(null);
  const [compareFailed, setCompareFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    setListFailed(false);
    friendsApi.list().then(
      (next) => alive && setList(next),
      (failure: unknown) => {
        logger.error("friends: list load failed", failure);
        if (alive) setListFailed(true);
      }
    );
    comparisonApi.people().then(
      (next) => alive && setBoards(next),
      (failure: unknown) => logger.error("friends: groups load failed", failure)
    );
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => {
    let alive = true;
    achievementsApi.getAll().then(
      (all) => alive && setCatalogue(all.achievements),
      // Without names the badges show their codes; the comparison itself still works.
      (failure: unknown) => logger.error("friends: achievement catalogue failed", failure)
    );
    return () => {
      alive = false;
    };
  }, []);

  // Pickable: an active connection. The first is picked for the reader; after that the pick is theirs.
  const friends = list?.friends.filter((f) => f.state === "active") ?? [];
  const friendKeys = new Set(friends.map((f) => f.key));
  const pickedKeys = (picked ?? friends.slice(0, 1).map((f) => f.key)).filter((k) =>
    friendKeys.has(k)
  );
  // A friend who gives no comparison has nothing to fetch; their panel says so.
  const comparedKeys = friends
    .filter((f) => pickedKeys.includes(f.key) && f.theirs.leaderboard)
    .map((f) => f.key);
  const query = `${year ?? "all"}|${comparedKeys.join(",")}`;

  useEffect(() => {
    if (!list || comparedKeys.length === 0) return;
    let alive = true;
    setCompareFailed(null);
    comparisonApi.compare(comparedKeys, year ?? "all").then(
      (data) => alive && setLoaded({ query, data }),
      (failure: unknown) => {
        logger.error("friends: compare failed", failure);
        if (alive) setCompareFailed(tr(`error.${comparisonFailureCode(failure)}`));
      }
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query is derived from year and the compared keys; version reloads
  }, [list, query, version]);

  // A group deleted here or elsewhere leaves the filter, rather than filtering to nobody.
  useEffect(() => {
    if (board && boards && !boards.boards.some((b) => b.id === board)) setBoard("");
  }, [board, boards]);

  const reload = (): void => setVersion((v) => v + 1);
  const withdraw = async (key: string): Promise<void> => {
    setNotice(null);
    try {
      await friendsApi.remove(key);
      reload();
    } catch (failure) {
      logger.error("friends: withdraw failed", failure);
      setNotice(tr(friendsErrorKey(failure)));
    }
  };
  const toggle = (key: string): void => {
    setNotice(null);
    if (pickedKeys.includes(key)) return setPicked(pickedKeys.filter((k) => k !== key));
    if (pickedKeys.length >= MAX_PICKED) return setNotice(tr("friends.limit"));
    setPicked([...pickedKeys, key]);
  };
  const toggleDomain = (d: DomainKey): void => {
    // From "Alle", a domain chip narrows to that domain; the last one off, or every one on, is "Alle" again.
    const next = new Set(domains ?? []);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    setDomains(next.size === 0 || next.size >= enabled.length ? null : next);
  };

  const data = loaded?.query === query ? loaded.data : null;

  const body = (): JSX.Element => {
    if (listFailed)
      return (
        <EmptyState
          kind="degraded"
          title={tr("peopleLoadFailed")}
          action={<Button onClick={reload}>{tr("common:buttons.retry")}</Button>}
        />
      );
    if (!list) return <p className="t-caption">{tr("common:loading.default")}</p>;
    if (friends.length === 0)
      return (
        <EmptyState
          title={tr("friends.noFriends")}
          description={tr("friends.noFriendsHint")}
          action={<Button onClick={() => setAdding(true)}>{tr("friends.add")}</Button>}
        />
      );
    if (pickedKeys.length === 0) return <p className="t-caption">{tr("friends.pickOne")}</p>;
    return (
      <div className="flex flex-col" style={{ gap: "var(--ts-space-xxl)" }}>
        {friends
          .filter((f) => pickedKeys.includes(f.key))
          .map((f) => (
            <FriendPanel
              key={f.key}
              friend={f}
              self={data?.self ?? null}
              row={data?.friends.find((r) => r.person.key === f.key)}
              compareFailed={compareFailed}
              year={year}
              domains={domains}
              isEnabled={isEnabled}
              catalogue={catalogue}
              onChanged={reload}
            />
          ))}
      </div>
    );
  };

  return (
    <AppShell width="table">
      <PageHeader title={tr("friends.title")} meta={tr("subtitle")} />
      <RequestsSection
        requests={list?.requests ?? []}
        admissions={list?.admissions ?? []}
        onChanged={reload}
      />
      <FriendPicker
        friends={list?.friends ?? []}
        boards={boards?.boards ?? []}
        board={board}
        onBoard={setBoard}
        picked={pickedKeys}
        onToggle={toggle}
        onAdd={() => setAdding(true)}
        onWithdraw={(key) => void withdraw(key)}
        notice={notice}
      />
      <div
        className="flex flex-wrap items-end"
        style={{ gap: "var(--ts-space-lg)", marginBottom: "var(--ts-space-xl)" }}
      >
        <Field label={tr("period.label")} htmlFor="friends-year">
          <Select
            id="friends-year"
            value={year === null ? "all" : String(year)}
            onChange={(e) => setYear(e.target.value === "all" ? null : Number(e.target.value))}
          >
            <option value="all">{tr("period.all")}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        <div
          role="group"
          aria-label={tr("friends.domains")}
          className="flex flex-wrap"
          style={{ gap: "var(--ts-space-sm)" }}
        >
          <Chip active={domains === null} onClick={() => setDomains(null)}>
            {tr("friends.allDomains")}
          </Chip>
          {enabled.map((d) => (
            <Chip key={d} active={domains?.has(d) ?? false} onClick={() => toggleDomain(d)}>
              {tr(`common:${DOMAINS[d].i18nKey}`)}
            </Chip>
          ))}
        </div>
      </div>
      {body()}
      {boards && <BoardsSection boards={boards.boards} people={boards.people} onChanged={reload} />}
      <AddFriendDialog open={adding} onClose={() => setAdding(false)} onChanged={reload} />
    </AppShell>
  );
}
