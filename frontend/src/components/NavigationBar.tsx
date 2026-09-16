import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { pendingUpdatesApi } from "../lib/api";
import { dataQualityFlagsApi } from "../lib/api/dataQualityFlags";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
import DiagnosticExportModal from "./DiagnosticExportModal";
import { LogoMark, LogoWordmark } from "./Brand/Logo";
import UpdateBadge from "./UpdateBadge";
import NavDropdown from "./Nav/NavDropdown";
import MoreMenu from "./Nav/MoreMenu";
import UserMenu from "./Nav/UserMenu";
import { Icon } from "./ui/Icon";
import { useSettingsStore } from "../store/settingsStore";
import { useNavItems, isPathActive, type NavLeaf } from "./Nav/useNavItems";

function PrimaryLink({ node, pathname }: { node: NavLeaf; pathname: string }): JSX.Element {
  const active = isPathActive(node.path, pathname);
  return (
    <Link
      to={node.path}
      aria-current={active ? "page" : undefined}
      className="relative flex items-center rounded-md px-3 text-sm"
      style={{
        height: "var(--ts-size-web-header)",
        fontWeight: active ? 700 : 500,
        color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
        // The round-4 marker: an accent bar on the header's bottom edge.
        boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
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
 * fold into "Mehr" as a first section — the phone row keeps logo, Mehr, inbox
 * and avatar, and nothing scrolls sideways.
 *
 * Gone from the row: the Bug button and the Support chip (both in the account
 * menu now) and the System chip (Einstellungen behind the avatar, Posteingang
 * and Admin under Mehr › Werkzeuge). The hamburger drawer went with them; it
 * duplicated the same entries in a second layout that had to be kept in step.
 */
export default function NavigationBar(): JSX.Element {
  const { user, logout } = useAuthStore();
  // The avatar comes from the settings profile; the name from the auth payload.
  const profilePicture = useSettingsStore((state) => state.profile.profilePicture);
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(["dashboard", "common", "dataQuality"]);
  // Two tables, one badge — the Posteingang is one page (see useNavItems).
  const [pendingUpdatesCount, setPendingUpdatesCount] = useState(0);
  const [openFlagCount, setOpenFlagCount] = useState(0);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);

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
      };
      loadInboxCounts();
      const interval = setInterval(loadInboxCounts, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate("/login");
  };

  const inboxCount = pendingUpdatesCount + openFlagCount;
  const { primary, more } = useNavItems(inboxCount);
  const inboxActive = isPathActive("/pending-updates", location.pathname);
  const inboxLabel =
    inboxCount > 0 ? `${t("dataQuality:inbox.nav")} (${inboxCount})` : t("dataQuality:inbox.nav");

  return (
    <>
      <header
        className="sticky top-0 z-50"
        style={{ background: "var(--ts-bg)", borderBottom: "1px solid var(--ts-border)" }}
      >
        <div
          className="flex items-center justify-between gap-2 px-4 sm:px-6"
          // The height other surfaces offset by (sticky settings index): one
          // token, so the two cannot drift.
          style={{ height: "var(--ts-size-web-header)" }}
        >
          {/* `min-w-0`: the wordmark is the one thing that can lose width
              without losing meaning (measured at 390px on 2026-09-15). */}
          <div className="flex min-w-0 items-center gap-3">
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
            <UpdateBadge />
            <nav
              aria-label={t("dashboard:nav.main")}
              className="ml-4 hidden md:flex items-center gap-1"
              style={{ height: "var(--ts-size-web-header)" }}
            >
              {primary.map((node) =>
                node.kind === "group" ? (
                  <NavDropdown key={node.id} group={node} />
                ) : (
                  <PrimaryLink key={node.id} node={node} pathname={location.pathname} />
                )
              )}
              <MoreMenu sections={more} />
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <div className="md:hidden">
              <MoreMenu sections={more} primary={primary} align="right" />
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
              onReportBug={() => setDiagnosticModalOpen(true)}
              onLogout={() => {
                handleLogout().catch(() => undefined);
              }}
            />
          </div>
        </div>
      </header>

      <DiagnosticExportModal
        isOpen={diagnosticModalOpen}
        onClose={() => setDiagnosticModalOpen(false)}
      />
    </>
  );
}
