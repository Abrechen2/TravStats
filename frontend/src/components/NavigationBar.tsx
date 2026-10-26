import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { pendingUpdatesApi } from "../lib/api";
import { dataQualityFlagsApi } from "../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../lib/api/tripSuggestions";
import { useSuggestionSwitchesStore } from "../store/suggestionSwitchesStore";
import { sharingApi } from "../lib/api/sharing";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
import DiagnosticExportModal from "./DiagnosticExportModal";
import UpdateBadge from "./UpdateBadge";
import NavDropdown from "./Nav/NavDropdown";
import MoreMenu from "./Nav/MoreMenu";
import UserMenu from "./Nav/UserMenu";
import { Icon } from "./ui/Icon";
import { useSettingsStore } from "../store/settingsStore";
import {
  useNavItems,
  isLeafActive,
  isPathActive,
  type NavLeaf,
  type NavNode,
} from "./Nav/useNavItems";
import AreaLogo from "./Nav/AreaLogo";
import { effectiveArea, planMenu, trackMenu, type AreaId } from "./Nav/areas";
import { areaColor } from "./ui/tokens";

function PrimaryLink({
  node,
  pathname,
  area,
}: {
  node: NavLeaf;
  pathname: string;
  area: AreaId;
}): JSX.Element {
  const active = isLeafActive(node, pathname);
  return (
    <Link
      to={node.path}
      aria-current={active ? "page" : undefined}
      className="relative flex items-center rounded-md px-3 text-sm"
      style={{
        height: "var(--ts-size-web-header)",
        fontWeight: active ? 700 : 500,
        color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
        // The round-4 marker, in the area's colour since phase 5: a bar on the
        // header's bottom edge.
        boxShadow: `inset 0 -2px 0 ${active ? areaColor(area) : "transparent"}`,
        borderRadius: 0,
      }}
    >
      {node.label}
    </Link>
  );
}

/**
 * The app header, round 4 (decision E1).
 *
 * Wordmark and, beside it, the four primary destinations and "Mehr"; the
 * Posteingang icon and the account menu right. Below `md` the destinations
 * fold into "Mehr" as a first section (below `lg` once the logo carries area words) — the phone row keeps logo, Mehr, inbox
 * and avatar, and nothing scrolls sideways.
 *
 * Gone from the row: the Bug button and the Support chip (both in the account
 * menu now) and the System chip (Einstellungen behind the avatar, Posteingang
 * and Admin under Mehr › Werkzeuge). The hamburger drawer went with them; it
 * duplicated the same entries in a second layout that had to be kept in step.
 *
 * Phase 5 of the TravTrack plan (header variant B): where TravPlan or
 * TravTrack is offered, the logo spells the areas — "Trav" + Stats · Plan ·
 * Track — and a divider leads into the ACTIVE area's menu. The area follows
 * the route (`effectiveArea`). Stats keeps the model above; Plan and Track
 * show their own entries, and on a phone those fold into a "Menü" button the
 * way Stats folds into "Mehr". Still one row: it wraps, it never adds a second.
 */
export default function NavigationBar(): JSX.Element {
  const { user, logout } = useAuthStore();
  const isAdmin = user?.isAdmin ?? false;
  // The avatar comes from the settings profile; the name from the auth payload.
  const profilePicture = useSettingsStore((state) => state.profile.profilePicture);
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(["dashboard", "common", "dataQuality", "track", "travplan"]);
  // Four sources, one badge — the Posteingang is one page (see useNavItems).
  const [pendingUpdatesCount, setPendingUpdatesCount] = useState(0);
  const [openFlagCount, setOpenFlagCount] = useState(0);
  const [tripSuggestionCount, setTripSuggestionCount] = useState(0);
  const [sharingCount, setSharingCount] = useState(0);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  // Switched off (forgejo#306), the kind is not counted at all. A dependency of
  // the effect below, so a flip re-counts at once instead of at the next poll.
  const tripSuggestionsOn = useSuggestionSwitchesStore((s) => s.trips);

  useEffect(() => {
    if (user) {
      // Counted separately and awaited separately: one endpoint failing must
      // not zero the other half of the badge.
      const loadInboxCounts = async () => {
        try {
          const data = await pendingUpdatesApi.getAll({ status: "pending" });
          setPendingUpdatesCount(data.count || 0);
        } catch {
          logger.warn("Failed to load pending updates count");
        }
        try {
          const data = await dataQualityFlagsApi.getAll({ status: "open" });
          setOpenFlagCount(data.count || 0);
        } catch {
          logger.warn("Failed to load data-quality flag count");
        }
        try {
          setTripSuggestionCount(tripSuggestionsOn ? await tripSuggestionsApi.count() : 0);
        } catch {
          logger.warn("Failed to load trip suggestion count");
        }
        try {
          setSharingCount(await sharingApi.inboxCount());
        } catch {
          logger.warn("Failed to load sharing inbox count");
        }
      };
      loadInboxCounts();
      const interval = setInterval(loadInboxCounts, 30000);
      return () => clearInterval(interval);
    }
  }, [user, tripSuggestionsOn]);

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate("/login");
  };

  const inboxCount = pendingUpdatesCount + openFlagCount + tripSuggestionCount + sharingCount;
  const { primary, more, areas } = useNavItems();
  const area = effectiveArea(location.pathname, areas);
  // Stats keeps the round-4 model; Plan and Track show their own menu and no
  // "Mehr" — the way back to the rest is the Stats word in the logo.
  const areaItems: NavLeaf[] | null =
    area === "track" ? trackMenu(t) : area === "plan" ? planMenu(t, isAdmin) : null;
  const row: NavNode[] = areaItems ?? primary;
  const areaTitle = area === "track" ? t("track:title") : t("travplan:title");
  const inboxActive = isPathActive("/pending-updates", location.pathname);
  const inboxLabel =
    inboxCount > 0 ? `${t("dataQuality:inbox.nav")} (${inboxCount})` : t("dataQuality:inbox.nav");

  // The area words make the logo wider (header B, phase 5): with them, the
  // row holds the inline destinations only from `lg`. At 820 px (iPad
  // portrait) logo, destinations, inbox and avatar did not fit, and the inbox
  // and the account menu fell to a second row on every page (UAT beta.28, D5).
  // Below that the destinations fold into the menu, as on a phone.
  const wide = areas.length > 1;

  return (
    <>
      <header
        className="sticky top-0 z-50"
        style={{ background: "var(--ts-bg)", borderBottom: "1px solid var(--ts-border)" }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-x-2 px-4 sm:px-6"
          // The height other surfaces offset by (sticky settings index): one
          // token, so the two cannot drift. A minimum, not a height: a phone
          // row that cannot hold three area words wraps instead of scrolling.
          style={{ minHeight: "var(--ts-size-web-header)" }}
        >
          {/* `min-w-0`: the wordmark is the one thing that can lose width
              without losing meaning (measured at 390px on 2026-09-15). */}
          <div className="flex min-w-0 items-center gap-3">
            <AreaLogo areas={areas} active={area} />
            <UpdateBadge />
            <nav
              aria-label={t("dashboard:nav.main")}
              data-testid="primary-nav"
              className={`ml-4 hidden items-center gap-1 ${wide ? "lg:flex" : "md:flex"}`}
              style={{ height: "var(--ts-size-web-header)" }}
            >
              {areas.length > 1 && (
                <span
                  aria-hidden="true"
                  data-testid="area-divider"
                  className="mr-2"
                  style={{ width: 1, height: 32, background: "var(--ts-border)" }}
                />
              )}
              {row.map((node) =>
                node.kind === "group" ? (
                  <NavDropdown key={node.id} group={node} />
                ) : (
                  <PrimaryLink key={node.id} node={node} pathname={location.pathname} area={area} />
                )
              )}
              {!areaItems && more.length > 0 && <MoreMenu sections={more} />}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <div className={wide ? "lg:hidden" : "md:hidden"} data-testid="nav-fold">
              {areaItems ? (
                <MoreMenu
                  sections={[
                    {
                      id: `area-${area}`,
                      label: areaTitle,
                      items: areaItems,
                    },
                  ]}
                  align="right"
                  label={t("dashboard:nav.menu")}
                />
              ) : (
                <MoreMenu sections={more} primary={primary} align="right" />
              )}
            </div>
            {/* Always reachable (owner rule 2026-09-05); the dot says whether
                something is waiting, the label says how much. */}
            <Link
              to="/pending-updates"
              aria-label={inboxLabel}
              title={inboxLabel}
              aria-current={inboxActive ? "page" : undefined}
              className="relative flex items-center justify-center rounded-md"
              style={{
                width: 40,
                height: 40,
                color: inboxActive ? "var(--ts-text-bright)" : "var(--ts-muted)",
                background: inboxActive ? "var(--ts-tile)" : "transparent",
              }}
            >
              <Icon name="inbox" size={18} />
              {inboxCount > 0 && (
                <span
                  aria-hidden="true"
                  data-testid="inbox-dot"
                  className="absolute h-2 w-2 rounded-full"
                  style={{ top: 9, right: 9, background: "var(--ts-warn)" }}
                />
              )}
            </Link>
            <UserMenu
              user={user}
              profilePicture={profilePicture}
              // The bundle carries every account's log tails, so the server
              // answers it to admins only (owner, 2026-09-25); an entry that
              // always fails would be worse than none.
              onReportBug={isAdmin ? () => setDiagnosticModalOpen(true) : undefined}
              isAdmin={isAdmin}
              onLogout={() => {
                handleLogout().catch(() => undefined);
              }}
            />
          </div>
        </div>
      </header>

      {isAdmin && (
        <DiagnosticExportModal
          isOpen={diagnosticModalOpen}
          onClose={() => setDiagnosticModalOpen(false)}
        />
      )}
    </>
  );
}
