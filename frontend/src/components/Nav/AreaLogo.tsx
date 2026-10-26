import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { LogoMark, LogoWordmark } from "../Brand/Logo";
import { areaColor } from "../ui/tokens";
import { AREA_HOME, AREA_ORDER, type AreaId } from "./areas";

const WORD_KEY: Record<AreaId, string> = {
  stats: "dashboard:nav.areas.stats",
  plan: "dashboard:nav.areas.plan",
  track: "dashboard:nav.areas.track",
};

/**
 * The logo, header variant B (TravTrack plan, phase 5): "Trav" once, then the
 * areas as words — the active one in its colour with a 3 px underline, the
 * others dimmed and one tap away. With Stats the only area, it is the logo it
 * always was, so an instance without TravPlan and TravTrack sees no change.
 */
export default function AreaLogo({
  areas,
  active,
}: {
  areas: readonly AreaId[];
  active: AreaId;
}): JSX.Element {
  const { t } = useTranslation(["common", "dashboard"]);

  if (areas.length <= 1) {
    return (
      <Link
        to="/dashboard"
        className="flex min-w-0 items-center gap-2.5 no-underline"
        aria-label={t("common:accessibility.home")}
      >
        <span aria-hidden="true" className="flex min-w-0 items-center gap-2.5">
          <LogoMark size={26} />
          <span className="hidden min-[400px]:flex">
            <LogoWordmark size={16} />
          </span>
        </span>
      </Link>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* The mark stays the way home; below 400 px it gives its width to the
          words, which are the switch. */}
      <Link
        to="/dashboard"
        className="hidden shrink-0 items-center no-underline min-[400px]:flex"
        aria-label={t("common:accessibility.home")}
      >
        <LogoMark size={26} />
      </Link>
      <nav
        aria-label={t("dashboard:nav.areas.label")}
        className="flex items-baseline text-base font-bold sm:text-xl"
      >
        <span aria-hidden="true" style={{ color: "var(--ts-text-bright)", marginRight: 2 }}>
          Trav
        </span>
        {AREA_ORDER.filter((id) => areas.includes(id)).map((id) => {
          const isActive = id === active;
          return (
            <Link
              key={id}
              to={AREA_HOME[id]}
              data-area={id}
              aria-current={isActive ? "true" : undefined}
              aria-label={`Trav${t(WORD_KEY[id])}`}
              className="inline-flex items-center no-underline"
              style={{
                minHeight: "var(--ts-size-touch-min, 44px)",
                padding: "0 4px",
                color: isActive ? areaColor(id) : "var(--ts-faint)",
                borderBottom: `3px solid ${isActive ? areaColor(id) : "transparent"}`,
              }}
            >
              {t(WORD_KEY[id])}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
