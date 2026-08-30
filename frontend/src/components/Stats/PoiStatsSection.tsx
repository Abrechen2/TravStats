import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { listPlaces } from "../../lib/api/places";
import { listPlaceLists, listCuratedChecklists } from "../../lib/api/placeLists";
import { adaptPoi } from "../../lib/stats/domain-stats/poiStatsAdapter";
import { derivePoiStats } from "../../lib/stats/poiStatsDetail";
import { PLACE_CATEGORIES } from "../../shared/placeCategories";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { logger } from "../../lib/logger";
import type { Place } from "../../types/place";
import type { CuratedListSummary, PlaceList } from "../../types/placeList";
import StatCard from "./StatCard";
import RankedBarList, { type RankedRow } from "./lodging/RankedBarList";
import PoiRhythmSection from "./poi/PoiRhythmSection";
import PoiFunSection from "./poi/PoiFunSection";
import PoiQualitySection from "./poi/PoiQualitySection";

/**
 * The places numbers, on the statistics page.
 *
 * The tab has existed since before 2.5.2 and rendered nothing at all: the page
 * had branches for every other domain and none for this one, so the strip
 * offered a tab that led to an empty screen. It only became conspicuous in
 * 2.6.0, which puts places in front.
 *
 * EVERY FIGURE COMES THROUGH `adaptPoi` OR `shared/placeCounting`, never from
 * counting rows inline. Those are the same modules the dashboard card and the
 * server's achievement engine use, which is what stops this page and the
 * places list disagreeing about whether an undated visit happened, or whether
 * a future-dated one counts yet.
 */
export default function PoiStatsSection(): JSX.Element {
  const { t, i18n } = useTranslation(["places", "stats", "common"]);
  const { colorOf } = useDomainColors();
  const accent = colorOf("poi");

  const [places, setPlaces] = useState<Place[] | null>(null);
  const [lists, setLists] = useState<PlaceList[]>([]);
  const [curated, setCurated] = useState<CuratedListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [placeRows, listRows, curatedRows] = await Promise.all([
          listPlaces({}),
          listPlaceLists(true),
          listCuratedChecklists(),
        ]);
        if (cancelled) return;
        setPlaces(placeRows);
        setLists(listRows);
        setCurated(curatedRows);
      } catch (err) {
        logger.error("PoiStatsSection: fetch failed", err);
        // A failed load says so. Falling through to zeros would read as "you
        // have never been anywhere", which is a different and worse claim.
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  // `DomainStats` is a union on `hasData`; narrowing it here means the figures
  // below read straight off it instead of each one re-checking.
  const stats = useMemo(() => {
    if (!places) return null;
    const adapted = adaptPoi({ places, lists, curated });
    return adapted.hasData ? adapted : null;
  }, [places, lists, curated]);

  // One derivation for the whole page, tested on its own. Nothing below counts
  // rows itself — that is how two figures on one screen come to disagree.
  const detail = useMemo(
    () => (places ? derivePoiStats(places, PLACE_CATEGORIES.length) : null),
    [places]
  );

  if (loading) {
    return <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>;
  }
  if (failed) {
    return <p className="text-sm text-(--text-muted)">{t("places:list.loadError")}</p>;
  }
  if (!stats || !detail || detail.visitedPlaces.length === 0) {
    return <p className="text-sm text-(--text-muted)">{t("places:stats.empty")}</p>;
  }

  const locale = i18n.language === "de" ? "de-DE" : "en-GB";

  const regionNames =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale], { type: "region" })
      : null;

  const toRows = (
    counts: Map<string, number>,
    label: (key: string) => string
  ): RankedRow[] => {
    const max = Math.max(...counts.values(), 1);
    return [...counts.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([key, value]) => ({
        key,
        label: label(key),
        weight: value / max,
        value: String(value),
      }));
  };

  const categoryRows = toRows(detail.categories, (key) => t(`places:categories.${key}`));
  const countryRows = toRows(detail.countries, (code) => regionNames?.of(code) ?? code);
  const cityRows = toRows(detail.cities, (city) => city);

  const mostVisitedMax = detail.mostVisited[0]?.visits ?? 1;
  const placeRows: RankedRow[] = detail.mostVisited.map(({ place, visits }) => ({
    key: place.id,
    label: place.name,
    weight: visits / mostVisitedMax,
    value: String(visits),
  }));

  // Checklists are ranked by SHARE, not by ticks: 3 of 7 is further along than
  // 4 of 20, and ordering by raw count would put the longest list on top
  // however little of it is done.
  const checklistRows: RankedRow[] = curated
    .filter((c) => c.itemCount > 0 && c.tickedCount > 0)
    .map((c) => ({
      key: c.key,
      label: (i18n.language === "de" ? c.name : (c.nameEn ?? c.name)) || c.key,
      weight: c.tickedCount / c.itemCount,
      value: `${c.tickedCount}/${c.itemCount}`,
      hint: `${Math.round((c.tickedCount / c.itemCount) * 100)} %`,
    }))
    .sort((a, b) => b.weight - a.weight);

  const ownLists = lists.filter((l) => l.curatedKey === null);

  return (
    <section>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.visitedPlaces")}
          value={detail.visitedPlaces.length}
          description={t("places:stats.visitedPlacesDesc", {
            wishlist: detail.wishlistCount,
          })}
        />
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.visits")}
          value={stats.totalEvents ?? 0}
          description={
            // Three states, because two of them read wrong as one. A place can
            // be marked visited without a dated visit — the detail page says so
            // in as many words — so "all dated" over a total of zero would be a
            // true sentence that means nothing. And an undated visit is counted
            // in the total but cannot be placed on a day, which is worth saying
            // rather than leaving the chart below to look incomplete.
            detail.visitsTotal === 0
              ? t("places:stats.noVisitsYet")
              : detail.visitsUndated > 0
                ? t("places:stats.visitsDesc", {
                    dated: detail.visitsDated,
                    undated: detail.visitsUndated,
                  })
                : t("places:stats.visitsAllDated")
          }
        />
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.countries")}
          value={detail.countries.size}
          description={t("places:stats.citiesDesc", { count: detail.cities.size })}
        />
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.lists")}
          value={lists.length}
          description={t("places:stats.listsDesc", {
            own: ownLists.length,
            checklists: lists.length - ownLists.length,
          })}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankedBarList
          title={t("places:stats.byCategory")}
          rows={categoryRows}
          accent={accent}
          emptyLabel={t("places:stats.empty")}
        />
        <RankedBarList
          title={t("places:stats.mostVisited")}
          rows={placeRows}
          accent={accent}
          emptyLabel={t("places:stats.noVisitsYet")}
          limit={8}
          moreLabel={(hidden) => t("places:stats.more", { count: hidden })}
        />
        <RankedBarList
          title={t("places:stats.byCountry")}
          rows={countryRows}
          accent={accent}
          emptyLabel={t("places:stats.empty")}
          limit={8}
          moreLabel={(hidden) => t("places:stats.more", { count: hidden })}
        />
        <RankedBarList
          title={t("places:stats.byCity")}
          rows={cityRows}
          accent={accent}
          emptyLabel={t("places:stats.noCities")}
          limit={8}
          moreLabel={(hidden) => t("places:stats.more", { count: hidden })}
        />
      </div>

      {checklistRows.length > 0 && (
        <div className="mt-6">
          <RankedBarList
            title={t("places:stats.checklists")}
            rows={checklistRows}
            accent={accent}
            emptyLabel={t("places:stats.empty")}
          />
        </div>
      )}

      <PoiRhythmSection detail={detail} accent={accent} locale={locale} />
      <PoiQualitySection detail={detail} accent={accent} />
      <PoiFunSection detail={detail} accent={accent} locale={locale} />
    </section>
  );
}
