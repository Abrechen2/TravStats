import type { JSX } from "react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { listCuratedChecklists, listPlaceLists } from "../../../lib/api/placeLists";
import { logger } from "../../../lib/logger";
import { curatedListKey, ownListKey, type ListSelectionKey } from "../../../lib/mapPlaceLists";
import { usePlaceListFilterStore } from "../../../store/placeListFilterStore";
import type { CuratedListSummary, PlaceList } from "../../../types/placeList";

const TOUCH_TARGET = 44;

interface Choice {
  key: ListSelectionKey;
  label: string;
}

/**
 * "Alle Orte" or one or more place lists, under the "Orte" row of the map's
 * domain selection. A disclosure inside the panel rather than a second popup:
 * the panel is already a dropdown on a desk and a sheet on a phone, and the rows
 * follow the pointer (`touch`) like the rest of it. The choice lives in
 * `placeListFilterStore`, so the flat map and the globe agree.
 */
export function PlaceListPicker({ touch }: { touch: boolean }): JSX.Element {
  const { t, i18n } = useTranslation(["dashboard"]);
  const selection = usePlaceListFilterStore((s) => s.selection);
  const toggle = usePlaceListFilterStore((s) => s.toggle);
  const clear = usePlaceListFilterStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState<PlaceList[] | null>(null);
  const [curated, setCurated] = useState<CuratedListSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const panelId = useId();
  const english = i18n.language.startsWith("en");

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const [lists, catalogue] = await Promise.all([
          listPlaceLists(false),
          listCuratedChecklists(),
        ]);
        if (cancelled) return;
        setOwn(lists);
        setCurated(catalogue);
        setFailed(false);
      } catch (err: unknown) {
        if (cancelled) return;
        logger.error("PlaceListPicker: failed to load the lists", err);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A subscribed checklist is a PlaceList too; it is offered once, as a curated list.
  const ownChoices: Choice[] = (own ?? [])
    .filter((l) => l.curatedKey === null)
    .map((l) => ({ key: ownListKey(l.id), label: l.name }));
  const curatedChoices: Choice[] = (curated ?? []).map((c) => ({
    key: curatedListKey(c.key),
    label: english ? (c.nameEn ?? c.name) : c.name,
  }));
  const labelOf = new Map([...ownChoices, ...curatedChoices].map((c) => [c.key, c.label]));

  const summary =
    selection.length === 0
      ? t("dashboard:domainFilter.placeLists.all")
      : selection.length === 1
        ? (labelOf.get(selection[0]) ?? t("dashboard:domainFilter.placeLists.count", { count: 1 }))
        : t("dashboard:domainFilter.placeLists.count", { count: selection.length });

  const rowStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minHeight: touch ? TOUCH_TARGET : 32,
    padding: "0 10px",
    background: "transparent",
    border: "none",
    textAlign: "left" as const,
    color: "var(--ts-text-bright)",
    fontSize: touch ? 14 : 13,
  };

  const choiceRow = (choice: Choice): JSX.Element => {
    const checked = selection.includes(choice.key);
    return (
      <button
        key={choice.key}
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-testid={`place-list-choice-${choice.key}`}
        onClick={() => toggle(choice.key)}
        className="cursor-pointer"
        style={rowStyle}
      >
        <span aria-hidden="true" style={{ width: 14 }}>
          {checked ? "✓" : ""}
        </span>
        <span className="flex-1 truncate">{choice.label}</span>
      </button>
    );
  };

  const groupHeading = (text: string): JSX.Element => (
    <div className="t-label-mono" style={{ padding: "6px 10px 2px", fontSize: 11 }}>
      {text}
    </div>
  );

  return (
    <div style={{ padding: "0 10px 4px 38px" }} data-testid="place-list-picker">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer"
        style={{
          background: "transparent",
          border: "1px solid var(--ts-border)",
          borderRadius: 8,
          color: "var(--ts-text-bright)",
          fontSize: touch ? 13.5 : 12.5,
          minHeight: touch ? TOUCH_TARGET : 28,
          padding: "0 10px",
          width: "100%",
          textAlign: "left",
        }}
      >
        <span style={{ color: "var(--ts-muted)" }}>
          {t("dashboard:domainFilter.placeLists.trigger")}:{" "}
        </span>
        {summary} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div
          id={panelId}
          style={{ maxHeight: 260, overflowY: "auto", marginTop: 4 }}
          data-testid="place-list-choices"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={selection.length === 0}
            data-testid="place-list-choice-all"
            onClick={clear}
            className="cursor-pointer"
            style={rowStyle}
          >
            <span aria-hidden="true" style={{ width: 14 }}>
              {selection.length === 0 ? "✓" : ""}
            </span>
            <span className="flex-1 truncate">{t("dashboard:domainFilter.placeLists.all")}</span>
          </button>
          {failed && (
            <div
              role="alert"
              style={{ color: "var(--ts-warn)", fontSize: 12, padding: "4px 10px" }}
            >
              {t("dashboard:domainFilter.placeLists.loadFailed")}
            </div>
          )}
          {!failed && own === null && (
            <div style={{ color: "var(--ts-muted)", fontSize: 12, padding: "4px 10px" }}>
              {t("dashboard:domainFilter.placeLists.loading")}
            </div>
          )}
          {ownChoices.length > 0 && (
            <>
              {groupHeading(t("dashboard:domainFilter.placeLists.own"))}
              {ownChoices.map(choiceRow)}
            </>
          )}
          {curatedChoices.length > 0 && (
            <>
              {groupHeading(t("dashboard:domainFilter.placeLists.curated"))}
              {curatedChoices.map(choiceRow)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
