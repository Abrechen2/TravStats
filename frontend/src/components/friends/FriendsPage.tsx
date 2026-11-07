import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { AppShell, Button, Chip, EmptyState, Field, PageHeader, Select } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS, type DomainKey } from "../../shared/domains";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import { achievementsApi } from "../../lib/api/achievements";
import type {
  CompareResponse,
  OwnAdmission,
  PeopleResponse,
  PersonView,
} from "../../lib/comparison/types";
import type { Achievement } from "../../types";
import { recentYears } from "../../lib/comparison/years";
import { logger } from "../../lib/logger";
import BoardsSection from "../comparison/BoardsSection";
import AchievementsCompare from "./AchievementsCompare";
import AddFriendDialog from "./AddFriendDialog";
import CompareTable, { type ComparedFriend } from "./CompareTable";
import FriendDetailSheet from "./FriendDetailSheet";
import FriendPicker, { MAX_PICKED } from "./FriendPicker";
import RequestsSection from "./RequestsSection";

/**
 * /freunde (spec 2026-11-07 §6.5): requests to answer, the friends to pick, then the picked
 * friends side by side — stats per domain, then achievements. The server builds every figure
 * under the consent each side gave; the page only lays them next to each other.
 */
export default function FriendsPage(): JSX.Element {
  const { t } = useTranslation(["comparison", "common", "achievements"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const { enabled, isEnabled } = useEnabledDomains();
  const zone = useSettingsStore((s) => s.display.timezone);
  const years = useMemo(() => recentYears(zone), [zone]);

  const [people, setPeople] = useState<PeopleResponse | null>(null);
  const [peopleFailed, setPeopleFailed] = useState(false);
  const [admissions, setAdmissions] = useState<OwnAdmission[]>([]);
  const [admissionsFailed, setAdmissionsFailed] = useState(false);
  const [catalogue, setCatalogue] = useState<Achievement[] | null>(null);
  const [version, setVersion] = useState(0);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [domains, setDomains] = useState<ReadonlySet<DomainKey> | null>(null);
  const [board, setBoard] = useState("");
  const [loaded, setLoaded] = useState<{ query: string; data: CompareResponse } | null>(null);
  const [compareFailed, setCompareFailed] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonView | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    setPeopleFailed(false);
    comparisonApi.people().then(
      (next) => alive && setPeople(next),
      (failure: unknown) => {
        logger.error("friends: people load failed", failure);
        if (alive) setPeopleFailed(true);
      }
    );
    setAdmissionsFailed(false);
    comparisonApi.listAdmissions().then(
      (next) => alive && setAdmissions(next),
      (failure: unknown) => {
        logger.error("friends: admissions load failed", failure);
        if (alive) setAdmissionsFailed(true);
      }
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

  // The first friend is picked for the reader; after that the pick is theirs alone.
  const friends = people?.people.filter((p) => p.mine?.status === "accepted") ?? [];
  const friendKeys = new Set(friends.map((p) => p.person.key));
  const pickedKeys = (picked ?? friends.slice(0, 1).map((p) => p.person.key)).filter((k) =>
    friendKeys.has(k)
  );
  const query = `${year ?? "all"}|${pickedKeys.join(",")}`;

  useEffect(() => {
    if (!people || pickedKeys.length === 0) return;
    let alive = true;
    setCompareFailed(null);
    comparisonApi.compare(pickedKeys, year ?? "all").then(
      (data) => alive && setLoaded({ query, data }),
      (failure: unknown) => {
        logger.error("friends: compare failed", failure);
        if (alive) setCompareFailed(tr(`error.${comparisonFailureCode(failure)}`));
      }
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query is derived from year and the picked keys; version reloads
  }, [people, query, version]);

  const reload = (): void => setVersion((v) => v + 1);
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
  const compared: ComparedFriend[] = pickedKeys.map((key) => {
    const person = people?.people.find((p) => p.person.key === key)?.person;
    return {
      key,
      name: person?.displayName ?? key,
      row: data?.friends.find((r) => r.person.key === key),
    };
  });

  const body = (): JSX.Element => {
    if (peopleFailed)
      return (
        <EmptyState
          kind="degraded"
          title={tr("peopleLoadFailed")}
          action={<Button onClick={reload}>{tr("common:buttons.retry")}</Button>}
        />
      );
    if (!people) return <p className="t-caption">{tr("common:loading.default")}</p>;
    if (friends.length === 0)
      return (
        <EmptyState
          title={tr("friends.noFriends")}
          description={tr("friends.noFriendsHint")}
          action={<Button onClick={() => setAdding(true)}>{tr("friends.add")}</Button>}
        />
      );
    if (pickedKeys.length === 0) return <p className="t-caption">{tr("friends.pickOne")}</p>;
    if (compareFailed)
      return (
        <EmptyState
          kind="degraded"
          title={tr("friends.loadFailed")}
          description={compareFailed}
          action={<Button onClick={reload}>{tr("common:buttons.retry")}</Button>}
        />
      );
    if (!data) return <p className="t-caption">{tr("common:loading.default")}</p>;
    return (
      <div className="flex flex-col" style={{ gap: "var(--ts-space-xxl)" }}>
        <CompareTable
          self={data.self}
          friends={compared}
          year={year}
          domains={domains}
          isEnabled={isEnabled}
        />
        <section>
          <h2 className="t-screen-title" style={{ marginBottom: "var(--ts-space-lg)" }}>
            {tr("achievements.title")}
          </h2>
          <AchievementsCompare
            self={data.self}
            friends={compared}
            year={year}
            catalogue={catalogue}
          />
        </section>
      </div>
    );
  };

  return (
    <AppShell width="table">
      <PageHeader title={tr("friends.title")} meta={tr("subtitle")} />
      {admissionsFailed && (
        <p className="t-caption" role="status">
          {tr("friends.admissionsFailed")}
        </p>
      )}
      <RequestsSection
        requests={people?.requests ?? []}
        admissions={admissions}
        onChanged={reload}
      />
      <FriendPicker
        people={people?.people ?? []}
        boards={people?.boards ?? []}
        board={board}
        onBoard={setBoard}
        picked={pickedKeys}
        onToggle={toggle}
        onAdd={() => setAdding(true)}
        onDetail={setDetail}
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
      {people && <BoardsSection boards={people.boards} people={people.people} onChanged={reload} />}
      {detail && (
        <FriendDetailSheet
          friend={people?.people.find((p) => p.person.key === detail.person.key) ?? detail}
          onClose={() => setDetail(null)}
          onChanged={reload}
        />
      )}
      <AddFriendDialog open={adding} onClose={() => setAdding(false)} onChanged={reload} />
    </AppShell>
  );
}
