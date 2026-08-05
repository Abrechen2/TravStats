/**
 * Chip row that drives the FlightsTablePage special-flight filter.
 * Extracted from the page component so FlightsTablePage stays under
 * the 800-line hard maximum from CLAUDE.md.
 */
import { useTranslation } from "../../hooks/useTranslation";
import { SPECIAL_TYPES, type SpecialType } from "./specialTypeMeta";

export type SpecialTypeFilter = "all" | "standard" | "special" | SpecialType;

interface Props {
  value: SpecialTypeFilter;
  onChange: (v: SpecialTypeFilter) => void;
}

const BASE_OPTIONS: ReadonlyArray<{ key: SpecialTypeFilter; labelKey: string }> = [
  { key: "all", labelKey: "specialFlights:filter.all" },
  { key: "standard", labelKey: "specialFlights:filter.standardOnly" },
  { key: "special", labelKey: "specialFlights:filter.allSpecial" },
];

export default function SpecialFlightFilter({ value, onChange }: Props): JSX.Element {
  const { t } = useTranslation(["specialFlights"]);

  const activeClass = "bg-(--accent)/20 border-(--accent)/50 text-(--accent)";
  const idleClass = "border-border text-(--text-muted)";

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-4 py-2"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <span
        className="text-[10px] uppercase tracking-wider mr-1"
        style={{ color: "var(--text-muted)" }}
      >
        {t("specialFlights:filter.label")}
      </span>
      {BASE_OPTIONS.map(({ key, labelKey }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`px-3 py-1 rounded-full text-xs border transition-colors ${
            value === key ? activeClass : idleClass
          }`}
        >
          {t(labelKey)}
        </button>
      ))}
      {SPECIAL_TYPES.map((type) => {
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(active ? "all" : type)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              active ? activeClass : idleClass
            }`}
          >
            {t(`specialFlights:specialType.${type}`)}
          </button>
        );
      })}
    </div>
  );
}
