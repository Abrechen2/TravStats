import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import Toggletip from "../../ui/Toggletip";
import { W } from "./model";
import type { Origin } from "./originFilter";
import Chip from "../../ui/Chip";

/** The source chips above the inbox's cards; the choice lives in `?origin=`. */
export default function OriginChips({
  chips,
  total,
  value,
  onChange,
}: {
  chips: (Origin & { count: number })[];
  total: number;
  value: string | null;
  onChange: (origin: string | null) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["dataQuality"]);
  if (chips.length === 0) return null;
  const chip = (key: string | null, label: string, count: number) => {
    const active = value === key;
    return (
      <Chip key={key ?? "all"} active={active} onClick={() => onChange(key)}>
        {label} <span style={{ fontFamily: "var(--ts-font-mono)" }}>{count}</span>
      </Chip>
    );
  };
  return (
    <div
      role="group"
      aria-label={t(`${W}.origin.label`)}
      className="flex flex-wrap items-center gap-1.5"
      data-testid="inbox-origin-chips"
    >
      {chip(null, t(`${W}.origin.all`), total)}
      {chips.map((c) => chip(c.key, c.label, c.count))}
      <Toggletip content={t(`${W}.origin.info`)} />
    </div>
  );
}
