import { useState } from "react";
import type { JSX } from "react";

import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useTranslation } from "../../hooks/useTranslation";
import type { LinkOneSidedView } from "../../types/sharingLink";
import { Button } from "../ui";

const NS = "sharing:link";

/** A calendar day as the server sent it (`YYYY-MM-DD`), or the instant's day. */
const dayOf = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");

/**
 * Entries only one copy holds (owner, 2026-11-28): never added silently. Each has an "Ergänzen?"
 * checkbox, unticked; a likely duplicate on the other side is named, and its box unlocks only once
 * the person opened the comparison. Boxes are 24 px, 44 px on a finger-operated screen.
 */
export default function OneSidedList({
  title,
  list,
  otherName,
  ticked,
  onToggle,
  disabled,
}: {
  title: string;
  list: LinkOneSidedView[];
  otherName: string;
  ticked: ReadonlySet<string>;
  onToggle: (ref: string, on: boolean) => void;
  disabled: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const coarse = useCoarsePointer();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  if (list.length === 0) return null;
  const box = coarse ? 44 : 24;
  return (
    <div data-testid="link-one-sided">
      <p className="t-caption">{title}</p>
      <ul className="flex flex-col text-sm" style={{ gap: "var(--ts-space-xs)" }}>
        {list.map((e, i) => {
          const ref = e.ref;
          const typeName = t(`${NS}.types.${e.entity}`);
          const dup = e.duplicateOf ?? null;
          const locked = !!dup && !!ref && !opened.has(ref);
          return (
            <li key={ref ?? `${e.entity}-${i}`} className="flex flex-col">
              <label className="flex items-center gap-2">
                {ref && (
                  <input
                    type="checkbox"
                    style={{ width: box, height: box }}
                    checked={ticked.has(ref)}
                    disabled={disabled || locked}
                    aria-label={t(`${NS}.oneSided.add`, { entry: e.label })}
                    onChange={(ev) => onToggle(ref, ev.target.checked)}
                  />
                )}
                <span>
                  {typeName}: {e.label} ({dayOf(e.when)})
                  {ref && ` · ${t(`${NS}.oneSided.addShort`)}`}
                </span>
              </label>
              {dup && (
                <span className="t-caption" data-testid="link-duplicate-hint">
                  {t(`${NS}.oneSided.duplicate`, { entry: dup.label, day: dayOf(dup.when) })}{" "}
                  {ref && !opened.has(ref) && (
                    <Button onClick={() => setOpened((prev) => new Set(prev).add(ref))}>
                      {t(`${NS}.oneSided.open`)}
                    </Button>
                  )}
                </span>
              )}
              {dup && ref && opened.has(ref) && (
                <span className="t-caption">
                  {t(`${NS}.oneSided.compare`, {
                    entry: `${e.label} (${dayOf(e.when)})`,
                    other: `${dup.label} (${dayOf(dup.when)})`,
                    name: otherName,
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
