import { useCallback, useEffect, useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { logger } from "../../../lib/logger";
import { trackErrorKey } from "../../../lib/api/travtrack";
import {
  daySourcesApi,
  type DaySourceChoice,
  type QuestionableDay,
} from "../../../lib/api/travtrackDaySources";
import { kindOfOrigin, sourceLabel } from "../../../pages/Track/trackDaySources";
import { Select } from "../../ui/Field";
import Button from "../../ui/Button";
import { ErrorLine } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";

const NS = "track:quality";
const AUTO = "";

type List =
  | { kind: "loading" }
  | { kind: "loaded"; total: number; days: QuestionableDay[]; page: number }
  | { kind: "failed"; key: string };

/**
 * Settings → TravTrack → "Tage mit fragwürdigen Spuren" (best source per
 * day): the days with a low score, mixed sources or open outliers, newest
 * first, each with its actions — open the day, choose its source, discard its
 * outliers, or delete a range through the delete section (which previews the
 * days and points and asks for confirmation). Every choice is reversible and
 * none changes a stored point; a failed one says why on its own row.
 */
export default function TravTrackQualitySection(): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const isDemo = useIsDemoAccount();
  const caps = useTravTrackCapabilities();
  const [list, setList] = useState<List>({ kind: "loading" });
  const [rowError, setRowError] = useState<{ date: string; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (page: number, keep: QuestionableDay[] = []) => {
    try {
      const read = await daySourcesApi.questionable(page);
      setList({ kind: "loaded", total: read.total, days: [...keep, ...read.days], page });
    } catch (err) {
      logger.warn("TravTrack questionable days could not be loaded", err);
      setList({ kind: "failed", key: trackErrorKey(err) });
    }
  }, []);

  useEffect(() => {
    if (caps?.enabled) void load(0);
  }, [caps?.enabled, load]);

  if (!caps || !caps.enabled) return null;

  const choose = async (date: string, choice: DaySourceChoice): Promise<void> => {
    setBusy(date);
    setRowError(null);
    try {
      await daySourcesApi.choose(date, choice);
      await load(0);
    } catch (err) {
      logger.warn("TravTrack day source choice failed", err);
      setRowError({ date, key: trackErrorKey(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard>
      <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }} data-testid="tt-quality">
        <p className="t-caption" style={{ margin: 0 }}>
          {t(`${NS}.intro`)}
        </p>
        {list.kind === "loading" ? (
          <p className="t-caption" style={{ margin: 0 }}>
            {t(`${NS}.loading`)}
          </p>
        ) : list.kind === "failed" ? (
          <ErrorLine>{t(list.key)}</ErrorLine>
        ) : list.days.length === 0 ? (
          <p className="t-caption" role="status" style={{ margin: 0 }}>
            {t(`${NS}.none`)}
          </p>
        ) : (
          <>
            <p className="t-caption" role="status" style={{ margin: 0 }}>
              {t(`${NS}.total`, { count: list.total })}
            </p>
            <ul
              className="flex flex-col"
              style={{ gap: "var(--ts-space-sm)", margin: 0, padding: 0 }}
            >
              {list.days.map((d) => (
                <li
                  key={d.date}
                  className="flex flex-wrap items-center"
                  style={{ gap: "var(--ts-space-sm)", listStyle: "none" }}
                  data-testid={`tt-quality-${d.date}`}
                >
                  <Link to={`/track/${d.date}`} className="t-body">
                    {d.date}
                  </Link>
                  <span className="t-caption">
                    {d.reasons.map((r) => t(`${NS}.reason.${r}`)).join(" · ")} ·{" "}
                    {t(`${NS}.score`, { score: Math.round(d.bestScore * 100) })}
                  </span>
                  {d.sources.length > 1 && (
                    <Select
                      aria-label={t(`${NS}.chooseSource`)}
                      value={AUTO}
                      disabled={isDemo || busy === d.date}
                      onChange={(e) =>
                        e.target.value !== AUTO &&
                        void choose(d.date, { overrideSource: e.target.value })
                      }
                    >
                      <option value={AUTO}>{t(`${NS}.chooseSource`)}</option>
                      {d.sources.map((src) => (
                        <option key={src} value={src}>
                          {sourceLabel(t, src, kindOfOrigin(src))}
                        </option>
                      ))}
                    </Select>
                  )}
                  {d.reasons.includes("outliers") && (
                    <Button
                      disabled={isDemo || busy === d.date}
                      onClick={() => void choose(d.date, { outlierDecision: "discard" })}
                    >
                      {t(`${NS}.discardOutliers`)}
                    </Button>
                  )}
                  {!isDemo && (
                    <Link
                      to={`/settings/tt-daten?from=${d.date}&until=${d.date}#ttDelete`}
                      className="t-caption"
                    >
                      {t(`${NS}.deleteRange`)}
                    </Link>
                  )}
                  {rowError?.date === d.date ? <ErrorLine>{t(rowError.key)}</ErrorLine> : null}
                </li>
              ))}
            </ul>
            {list.days.length < list.total && (
              <Button onClick={() => void load(list.page + 1, list.days)}>{t(`${NS}.more`)}</Button>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
