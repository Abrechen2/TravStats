import Chip from "../../ui/Chip";
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { formatLocalClock, formatLocalDate } from "../../../lib/displayFormat";
import {
  getListRule,
  listAutoAccepted,
  listNewOutlets,
  undoAutoAccepted,
  type ListRule,
  type SmartSuggestion,
} from "../../../lib/api/smartLists";
import { BrandRuleDialog } from "./BrandRuleDialog";
import { SuggestionRow } from "./SuggestionRow";

const COARSE =
  "pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)";

/** The rule header, new outlets and the automatic feed of one list; `openRule` comes from the page's ⋯. */
export default function SmartListPanel({
  listId,
  ruleOpen,
  onRuleClose,
  onChanged,
}: {
  listId: string;
  ruleOpen: boolean;
  onRuleClose: () => void;
  /** The list's membership changed (a suggestion confirmed, an automatic entry undone). */
  onChanged: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["places", "common"]);
  const [rule, setRule] = useState<ListRule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [outlets, setOutlets] = useState<SmartSuggestion[]>([]);
  const [auto, setAuto] = useState<SmartSuggestion[]>([]);
  const [failed, setFailed] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await getListRule(listId);
      setRule(next);
      if (next) {
        const [o, a] = await Promise.all([listNewOutlets(listId), listAutoAccepted(listId)]);
        setOutlets(o);
        setAuto(a);
      } else {
        setOutlets([]);
        setAuto([]);
      }
      setFailed(false);
    } catch (err: unknown) {
      logger.error({ err }, "SmartListPanel: could not read the rule");
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [listId]);

  useEffect(() => {
    void load();
  }, [load]);

  const undo = async (row: SmartSuggestion): Promise<void> => {
    setUndoing(row.id);
    setUndoError(null);
    try {
      await undoAutoAccepted(row.id);
      await load();
      onChanged();
    } catch (err: unknown) {
      logger.error({ err }, "SmartListPanel: undo failed");
      setUndoError("places:smartList.undoFailed");
    } finally {
      setUndoing(null);
    }
  };

  return (
    <>
      {loaded && failed && (
        <p role="alert" className="mb-4 text-sm" style={{ color: "var(--danger)" }}>
          {t("places:smartList.loadFailed")}
        </p>
      )}
      {rule && (
        <section className="mb-6" aria-label={t("places:smartList.headerLabel")}>
          <Chip testId="smart-list-badge">
            {t("places:smartList.header", {
              brands: rule.brands.map((b) => b.brandName).join(", "),
            })}
          </Chip>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {t("places:smartList.headerRule", {
              min: rule.minDwellMinutes,
              max: rule.maxDwellMinutes,
              distance: rule.maxDistanceM,
              autoDistance: rule.autoAcceptDistanceM,
              auto: rule.autoAccept ? t("places:smartList.autoOn") : t("places:smartList.autoOff"),
            })}
          </p>

          {outlets.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("places:smartList.newOutlets")}
              </h2>
              <ul className="grid gap-2" style={{ listStyle: "none", padding: 0 }}>
                {outlets.map((row) => (
                  <SuggestionRow
                    key={row.id}
                    suggestion={row}
                    title={row.name ?? undefined}
                    onAnswered={() => {
                      void load();
                      onChanged();
                    }}
                  />
                ))}
              </ul>
            </div>
          )}

          {auto.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("places:smartList.recentAuto")}
              </h2>
              {undoError && (
                <p role="alert" className="mb-2 text-sm" style={{ color: "var(--danger)" }}>
                  {t(undoError)}
                </p>
              )}
              <ul className="grid gap-2" style={{ listStyle: "none", padding: 0 }}>
                {auto.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <span
                      className="min-w-0 flex-1 text-sm"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {row.name}
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        {t("places:smartList.autoLine", {
                          date: formatLocalDate(row.startLocal),
                          time: formatLocalClock(row.startLocal),
                          minutes: row.durationMinutes,
                          distance: row.distanceM ?? "?",
                        })}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={undoing === row.id}
                      onClick={() => void undo(row)}
                      className={`rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
                      style={{
                        border: "1px solid var(--color-border)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {t("places:smartList.undo")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {ruleOpen && (
        <BrandRuleDialog
          listId={listId}
          rule={rule}
          onClose={onRuleClose}
          onSaved={(next) => {
            setRule(next);
            onRuleClose();
            void load();
          }}
        />
      )}
    </>
  );
}
