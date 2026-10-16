import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { AppShell, Button, EmptyState, Field, PageHeader, Select } from "../ui";
import { Segmented } from "../ui/Segmented";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";
import {
  LEADERBOARD_METRICS,
  METRIC_GROUPS,
  type MetricGroup,
} from "../../shared/comparisonMetrics";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type { LeaderboardResponse, PeopleResponse } from "../../lib/comparison/types";
import { recentYears } from "../../lib/comparison/years";
import { logger } from "../../lib/logger";
import LeaderboardTile from "./LeaderboardTile";
import PeopleSection from "./PeopleSection";
import AddPersonCard from "./AddPersonCard";
import BoardsSection from "./BoardsSection";

/**
 * /compare (spec 2026-10-16 §11): totals only, ranked per figure, built from server-side
 * aggregates under each friend's consent. No keys, no decryption — that is /encrypted-share.
 */
export default function LeaderboardPage(): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string): string => String(t(key));
  const { isEnabled } = useEnabledDomains();
  const zone = useSettingsStore((s) => s.display.timezone);
  const years = useMemo(() => recentYears(zone), [zone]);
  const [group, setGroup] = useState<MetricGroup>("distance");
  const [year, setYear] = useState<number | null>(null);
  const [board, setBoard] = useState("");
  // The answer remembers which period and group it is for: after a filter changes, the old
  // numbers are not shown under the new filter while its answer is on the way.
  const query = `${year ?? "all"}|${board}`;
  const [loaded, setLoaded] = useState<{ query: string; data: LeaderboardResponse } | null>(null);
  const [people, setPeople] = useState<PeopleResponse | null>(null);
  // One flag per load: each effect clears only its own, so a leaderboard reload (another
  // period) cannot hide that the people list — requests and groups — did not arrive.
  const [peopleFailed, setPeopleFailed] = useState(false);
  const [boardFailed, setBoardFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const addRef = useRef<HTMLDivElement>(null);

  // The people list loads on its own: when the leaderboard fails — a group deleted under the
  // filter answers 404 — the group list must still refresh, or nothing can clear the filter.
  useEffect(() => {
    let alive = true;
    setPeopleFailed(false);
    comparisonApi.people().then(
      (nextPeople) => {
        if (alive) setPeople(nextPeople);
      },
      (failure: unknown) => {
        logger.error("comparison: people load failed", failure);
        if (alive) setPeopleFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => {
    let alive = true;
    setBoardFailed(false);
    comparisonApi.leaderboard(year, board || undefined).then(
      (nextData) => {
        if (alive) setLoaded({ query, data: nextData });
      },
      (failure: unknown) => {
        if (!alive) return;
        // The selected group is gone on the server: show everyone instead of failing on it.
        if (board && comparisonFailureCode(failure) === "COMPARISON_BOARD_NOT_FOUND") {
          setBoard("");
          return;
        }
        logger.error("comparison: load failed", failure);
        // A failed load says so; empty tiles would claim "nobody travelled".
        setBoardFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [year, board, version]);

  // A group that was deleted (here or by a reload) leaves the filter, rather than filtering
  // to nothing under a name the picker no longer offers.
  useEffect(() => {
    if (board && people && !people.boards.some((b) => b.id === board)) setBoard("");
  }, [board, people]);

  const data = loaded?.query === query ? loaded.data : null;
  const reload = (): void => setVersion((v) => v + 1);
  // `scrollIntoView` is missing in jsdom, hence the second `?.`.
  const addPerson = (): void => addRef.current?.scrollIntoView?.({ behavior: "smooth" });
  const rows = data?.rows ?? [];
  // A cross-domain figure (domain null) always applies; the rest only for domains the reader uses.
  const metrics = LEADERBOARD_METRICS.filter(
    (m) => m.group === group && (m.domain === null || isEnabled(m.domain))
  );

  return (
    <AppShell width="list">
      <PageHeader
        title={tr("title")}
        meta={tr("subtitle")}
        actions={<Button onClick={addPerson}>{tr("addPerson")}</Button>}
      />
      <div
        className="flex flex-wrap items-end"
        style={{ gap: "var(--ts-space-lg)", marginBottom: "var(--ts-space-xl)" }}
      >
        <Segmented
          label={tr("group.label")}
          value={group}
          onChange={setGroup}
          options={METRIC_GROUPS.map((g) => ({ value: g, label: tr(`group.${g}`) }))}
        />
        <Field label={tr("period.label")} htmlFor="comparison-year">
          <Select
            id="comparison-year"
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
        {people && people.boards.length > 0 && (
          <Field label={tr("board.label")} htmlFor="comparison-board">
            <Select id="comparison-board" value={board} onChange={(e) => setBoard(e.target.value)}>
              <option value="">{tr("board.all")}</option>
              {people.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {boardFailed ? (
        <EmptyState
          kind="degraded"
          title={tr("loadFailed")}
          action={<Button onClick={reload}>{tr("common:buttons.retry")}</Button>}
        />
      ) : !data ? (
        <p className="t-caption">{tr("common:loading.default")}</p>
      ) : rows.length <= 1 && board ? (
        <EmptyState
          title={tr("empty.boardTitle")}
          description={tr("empty.boardDescription")}
          action={<Button onClick={() => setBoard("")}>{tr("board.all")}</Button>}
        />
      ) : rows.length <= 1 ? (
        <EmptyState
          title={tr("empty.title")}
          description={tr("empty.description")}
          action={<Button onClick={addPerson}>{tr("addPerson")}</Button>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {metrics.map((m) => (
              <LeaderboardTile key={m.key} metric={m} rows={rows} year={data.year} />
            ))}
          </div>
          <p className="t-caption">{tr("tile.partialHint")}</p>
        </>
      )}
      {peopleFailed ? (
        <EmptyState
          kind="degraded"
          title={tr("peopleLoadFailed")}
          action={<Button onClick={reload}>{tr("common:buttons.retry")}</Button>}
        />
      ) : (
        people && <PeopleSection people={people} onChanged={reload} />
      )}
      <div ref={addRef}>
        <AddPersonCard onChanged={reload} />
      </div>
      {people && <BoardsSection boards={people.boards} people={people.people} onChanged={reload} />}
    </AppShell>
  );
}
