/**
 * Small inline pill rendered next to a flight row / card when the
 * flight has a non-null specialType. Uses the shared icon + colour from
 * SPECIAL_TYPE_META so the colour scheme stays consistent across
 * table / map / legend.
 */
import { useTranslation } from "../../hooks/useTranslation";
import { SPECIAL_TYPE_META, rgbToCss, type SpecialType } from "./specialTypeMeta";

interface Props {
  type: SpecialType;
}

export default function SpecialTypeBadge({ type }: Props): JSX.Element {
  const { t } = useTranslation(["specialFlights"]);
  const meta = SPECIAL_TYPE_META[type];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
      style={{
        background: rgbToCss(meta.rgb, 0.15),
        borderColor: rgbToCss(meta.rgb, 0.45),
        color: rgbToCss(meta.rgb, 1),
      }}
      title={t(`specialFlights:specialType.${type}`)}
    >
      <span aria-hidden>{meta.icon}</span>
      <span>{t(`specialFlights:specialType.${type}`)}</span>
    </span>
  );
}
