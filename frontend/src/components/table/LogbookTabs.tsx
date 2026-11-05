import type { JSX } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { AVAILABLE_DOMAINS, DOMAINS } from "../../shared/domains";
import { Icon } from "../ui/Icon";
import { DOMAIN_ICON } from "../ui/domainIcons";
import type { IconName } from "../ui/Icon";
import { isPathActive } from "../Nav/useNavItems";

const PLACE_LISTS_PATH = "/places/lists";

/**
 * The logbook's own tabs: one per enabled area, directly under the header.
 *
 * Round 4 ("Logbuch Flüge") draws them on every logbook page, so moving from
 * flights to stays is one click where it used to be the header's Logbuch
 * dropdown. The areas come from the same rules the navigation uses — a
 * disabled area has no tab. No counts: each page knows only its own list, and
 * fetching three other lists to print a number is not worth a page load.
 */
export default function LogbookTabs(): JSX.Element | null {
  const { t } = useTranslation(["common", "dashboard", "places"]);
  const { isEnabled } = useEnabledDomains();
  const placesVisible = usePlacesVisible();
  const { pathname } = useLocation();

  // The same rule as the navigation: places ask their own hook, every other
  // domain's beta switch is already applied by `isEnabled`.
  const areas = AVAILABLE_DOMAINS.filter((key) => (key === "poi" ? placesVisible : isEnabled(key)));
  if (areas.length < 2) return null;

  const onLists = pathname.startsWith(PLACE_LISTS_PATH);
  const tabs: { id: string; path: string; icon: IconName; label: string; active: boolean }[] =
    areas.flatMap((key) => {
      const path = DOMAINS[key].routePrefix;
      // `/places/lists` belongs to the collections tab below, not to this one.
      const area = {
        id: key,
        path,
        icon: DOMAIN_ICON[key],
        label: t(`common:${DOMAINS[key].i18nKey}`),
        active: isPathActive(path, pathname) && !onLists,
      };
      // Lists and the curated checklists hang off the places area; they used to
      // be reachable only through a small button on /places.
      return key === "poi"
        ? [
            area,
            {
              id: "place-lists",
              path: PLACE_LISTS_PATH,
              icon: "list" as const,
              label: t("places:lists.title"),
              active: onLists,
            },
          ]
        : [area];
    });

  return (
    <nav
      aria-label={t("dashboard:nav.logbook")}
      className="-mt-2 mb-6 flex overflow-x-auto scrollbar-none"
      style={{ borderBottom: "1px solid var(--ts-border)" }}
    >
      {tabs.map(({ id, path, icon, label, active }) => (
        <Link
          key={id}
          to={path}
          aria-current={active ? "page" : undefined}
          className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3 text-sm"
          style={{
            fontWeight: active ? 700 : 500,
            color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
            boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
          }}
        >
          <Icon name={icon} size={16} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
