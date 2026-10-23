import { useState } from "react";
import type { JSX } from "react";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { groupChoice, groupOf, type LocalTransitGroup } from "./railImportModes";
import type { RailImportRow } from "./railImportModel";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * „Als Standard merken“ for U-Bahn/tram and for bus legs (2026-10-23): the
 * account's default is written only here, on an explicit click, and only when
 * every leg of the group was chosen alike — one import alone never changes it.
 */
export function RailImportRemember({
  rows,
  busEnabled,
  disabled,
  t,
}: {
  rows: readonly RailImportRow[];
  busEnabled: boolean;
  disabled: boolean;
  t: Translate;
}): JSX.Element | null {
  const groups = (["localTransit", "bus"] as const).filter(
    (g) => rows.some((r) => groupOf(r.leg) === g) && (g !== "bus" || busEnabled)
  );
  if (groups.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="rail-import-remember">
      {groups.map((group) => (
        <RememberLine key={group} group={group} rows={rows} disabled={disabled} t={t} />
      ))}
    </div>
  );
}

function RememberLine({
  group,
  rows,
  disabled,
  t,
}: {
  group: LocalTransitGroup;
  rows: readonly RailImportRow[];
  disabled: boolean;
  t: Translate;
}): JSX.Element {
  const stored = useSuggestionSwitchesStore((s) =>
    group === "bus" ? s.railImportBus : s.railImportLocalTransit
  );
  const setLocalTransit = useSuggestionSwitchesStore((s) => s.setRailImportLocalTransit);
  const setBus = useSuggestionSwitchesStore((s) => s.setRailImportBus);
  const [remembered, setRemembered] = useState(false);
  const choice = groupChoice(rows, group);
  const current = choice !== null && choice === stored;

  const remember = (): void => {
    if (choice === null) return;
    if (group === "bus") setBus(choice === "bus" ? "bus" : "skip");
    else setLocalTransit(choice === "rail" ? "rail" : "skip");
    setRemembered(true);
  };

  const status =
    choice === null
      ? t("rail:import.remember.mixed")
      : remembered && current
        ? t("rail:import.remember.done")
        : current
          ? t("rail:import.remember.isDefault")
          : null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        onClick={remember}
        disabled={disabled || choice === null || current}
        className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)"
        data-testid={`rail-import-remember-${group}`}
      >
        {t(`rail:import.remember.${group}.${choice ?? "skip"}`)}
      </button>
      {status && <span className="t-caption">{status}</span>}
    </div>
  );
}
