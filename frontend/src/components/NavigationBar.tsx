import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { pendingUpdatesApi } from "../lib/api";
import { dataQualityFlagsApi } from "../lib/api/dataQualityFlags";
import { useTranslation } from "../hooks/useTranslation";
import { useClickOutside } from "../hooks/useClickOutside";
import { logger } from "../lib/logger";
import DiagnosticExportModal from "./DiagnosticExportModal";
import { LogoMark, LogoWordmark } from "./Brand/Logo";
import UpdateBadge from "./UpdateBadge";
import NavDropdown, { type ExternalLink } from "./Nav/NavDropdown";
import UserMenu from "./Nav/UserMenu";
import { displayName } from "../lib/userDisplay";
import { useSettingsStore } from "../store/settingsStore";
import { useNavItems, isPathActive, type NavLeaf } from "./Nav/useNavItems";

function DesktopLeaf({ node, pathname }: { node: NavLeaf; pathname: string }): JSX.Element {
  const active = isPathActive(node.path, pathname);
  const hasBadge = (node.badge ?? 0) > 0;
  return (
    <Link
      to={node.path}
      aria-current={active ? "page" : undefined}
      className="relative px-3 py-1.5 text-sm transition-colors duration-200 rounded-md"
      style={{
        fontWeight: active ? 600 : 500,
        color: active ? "var(--accent)" : node.warn ? "var(--warning)" : "var(--text-muted)",
        background: active ? "var(--bg-elevated)" : "transparent",
      }}
    >
      {node.label}
      {node.betaBadge && (
        <span className="ml-1.5 inline-flex items-center rounded-sm px-1 py-0.5 text-[10px] font-medium leading-none text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/20">
          Beta
        </span>
      )}
      {active && (
        <span
          className="absolute -bottom-px left-2 right-2 h-[3px] rounded-full"
          style={{ background: "var(--accent)" }}
        />
      )}
      {hasBadge && (
        <span
          className="absolute -top-1 -right-1 text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center"
          style={{ background: "var(--danger)", color: "#fff" }}
        >
          {(node.badge ?? 0) > 9 ? "9+" : node.badge}
        </span>
      )}
    </Link>
  );
}

function MobileLeaf({
  node,
  indent = false,
  onNavigate,
}: {
  node: NavLeaf;
  indent?: boolean;
  onNavigate: () => void;
}): JSX.Element {
  const location = useLocation();
  const active = isPathActive(node.path, location.pathname);
  const hasBadge = (node.badge ?? 0) > 0;
  return (
    <Link
      to={node.path}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
        indent ? "pl-7" : ""
      }`}
      style={{
        fontWeight: active ? 600 : 500,
        background: active ? "var(--bg-elevated)" : "transparent",
        color: active ? "var(--accent)" : node.warn ? "var(--warning)" : "var(--text-muted)",
        borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
      }}
    >
      <span className="flex items-center gap-1.5">
        {node.label}
        {node.betaBadge && (
          <span className="inline-flex items-center rounded-sm px-1 py-0.5 text-[10px] font-medium leading-none text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/20">
            Beta
          </span>
        )}
      </span>
      {hasBadge && (
        <span
          className="text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center"
          style={{ background: "var(--danger)", color: "#fff" }}
        >
          {(node.badge ?? 0) > 9 ? "9+" : node.badge}
        </span>
      )}
    </Link>
  );
}

export default function NavigationBar(): JSX.Element {
  const { user, logout } = useAuthStore();
  // The avatar comes from the settings profile (the picture already had an
  // upload path long before #241); the name comes from the auth payload.
  const profilePicture = useSettingsStore((state) => state.profile.profilePicture);
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(["dashboard", "common", "cruise", "trips", "lodging"]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Two tables, one badge — the Posteingang is one page (see useNavItems).
  const [pendingUpdatesCount, setPendingUpdatesCount] = useState(0);
  const [openFlagCount, setOpenFlagCount] = useState(0);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useClickOutside(mobileMenuRef, closeMobileMenu);

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

  const { center, system } = useNavItems(pendingUpdatesCount + openFlagCount);

  const supportLinks: ExternalLink[] = [
    {
      id: "donate",
      label: t("common:support.donate"),
      href: "https://www.paypal.com/donate?hosted_button_id=HW9MPYVURCT42",
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="#e85d8a" aria-hidden="true">
          <path d="M8 14s-6-3.9-6-8a4 4 0 0 1 6-3.44A4 4 0 0 1 14 6c0 4.1-6 8-6 8z" />
        </svg>
      ),
    },
    {
      id: "star",
      label: t("common:support.star"),
      href: "https://github.com/Abrechen2/TravStats",
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="#f5a623" aria-hidden="true">
          <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
        </svg>
      ),
    },
    {
      id: "discord",
      label: "Discord",
      href: "https://discord.gg/CRnjB9f78t",
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="#5865F2" aria-hidden="true">
          <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612" />
        </svg>
      ),
    },
  ];

  return (
    <>
      <header
        className="sticky top-0 z-50 backdrop-blur-md"
        style={{
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div className="px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Left: Hamburger + Wordmark */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="xl:hidden p-2 rounded-lg transition-colors nav-icon-btn"
                style={{ color: "var(--text-muted)" }}
                aria-label={t("common:accessibility.toggleMenu")}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  )}
                </svg>
              </button>

              <Link
                to="/"
                className="flex items-center gap-2.5 no-underline"
                aria-label={t("common:accessibility.home")}
              >
                <span aria-hidden="true" className="flex items-center gap-2.5">
                  <LogoMark size={26} />
                  <LogoWordmark size={16} />
                </span>
              </Link>
              <UpdateBadge />
            </div>

            {/* Center: Desktop Navigation */}
            <nav className="hidden xl:flex items-center gap-1">
              {center.map((node) =>
                node.kind === "group" ? (
                  <NavDropdown key={node.id} group={node} />
                ) : (
                  <DesktopLeaf key={node.id} node={node} pathname={location.pathname} />
                )
              )}
            </nav>

            {/* Right: Support + System + Username + Logout */}
            <div className="flex items-center gap-2">
              {/* Bug-Report button — visible on all breakpoints so users can
                  always reach the diagnostic export. Support / System stay
                  desktop-only because they're brand vanity / secondary nav. */}
              <button
                type="button"
                onClick={() => setDiagnosticModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] font-medium transition-colors duration-150"
                style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#f85149";
                  e.currentTarget.style.color = "#f85149";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
                aria-label={t("common:diagnostic.reportBug")}
                title={t("common:diagnostic.reportBug")}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="#f85149" aria-hidden="true">
                  <path d="M4 1a1 1 0 0 1 2 0 1 1 0 0 1 1 1H5a1 1 0 0 1-1-1zm8 1a1 1 0 0 0-2 0 1 1 0 0 0-1 1h2a1 1 0 0 0 1-1zM2.5 5a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1h-2v1h3a.5.5 0 0 1 0 1h-3v1.5a3 3 0 1 1-6 0V7.5h-3a.5.5 0 0 1 0-1h3v-1H3a.5.5 0 0 1-.5-.5zM6.5 9.5v.5a1.5 1.5 0 1 0 3 0v-.5h-3z" />
                </svg>
                Bug
              </button>
              <div className="hidden xl:block">
                <NavDropdown
                  label={t("dashboard:nav.support")}
                  externalLinks={supportLinks}
                  align="right"
                  variant="chip"
                />
              </div>
              <div className="hidden xl:block">
                {system.kind === "group" ? (
                  <NavDropdown group={system} align="right" variant="chip" />
                ) : (
                  (() => {
                    const active = isPathActive(system.path, location.pathname);
                    return (
                      <Link
                        to={system.path}
                        aria-current={active ? "page" : undefined}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] font-medium"
                        style={{
                          color: active ? "var(--accent)" : "var(--text-muted)",
                          borderColor: active ? "var(--accent)" : "var(--color-border)",
                          border: `1px solid ${active ? "var(--accent)" : "var(--color-border)"}`,
                          fontWeight: active ? 600 : 500,
                        }}
                      >
                        {system.label}
                      </Link>
                    );
                  })()
                )}
              </div>
              <UserMenu
                user={user}
                profilePicture={profilePicture}
                onLogout={() => {
                  handleLogout().catch(() => undefined);
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Backdrop */}
      {mobileMenuOpen && (
        <div
          className="xl:hidden fixed inset-0 bg-black/60 z-55"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu Panel */}
      {mobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          className="xl:hidden fixed inset-y-0 left-0 w-72 max-w-[calc(100vw-3rem)] z-60 flex flex-col"
          style={{
            background: "var(--bg-surface)",
            borderRight: "1px solid var(--color-border)",
          }}
        >
          <div className="p-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <LogoMark size={22} />
                <LogoWordmark size={14} />
              </span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg"
                style={{ color: "var(--text-muted)" }}
                aria-label={t("common:accessibility.close")}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
            {center.map((node) =>
              node.kind === "group" ? (
                <div key={node.id}>
                  <div
                    className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {node.label}
                  </div>
                  {node.children.map((child) => (
                    <MobileLeaf key={child.id} node={child} indent onNavigate={closeMobileMenu} />
                  ))}
                </div>
              ) : (
                <MobileLeaf key={node.id} node={node} onNavigate={closeMobileMenu} />
              )
            )}
            <div className="my-2" style={{ borderTop: "1px solid var(--color-border)" }} />
            {system.kind === "group" ? (
              <div>
                <div
                  className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  {system.label}
                </div>
                {system.children.map((child) => (
                  <MobileLeaf key={child.id} node={child} indent onNavigate={closeMobileMenu} />
                ))}
              </div>
            ) : (
              <MobileLeaf node={system} onNavigate={closeMobileMenu} />
            )}
          </nav>

          <div className="p-4" style={{ borderTop: "1px solid var(--color-border)" }}>
            <div
              className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {t("dashboard:nav.support")}
            </div>
            <div className="flex gap-1.5 mb-3">
              <a
                href="https://www.paypal.com/donate?hosted_button_id=HW9MPYVURCT42"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 flex-1 py-1 rounded-sm text-[11px] font-medium transition-colors duration-150"
                style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#e85d8a";
                  e.currentTarget.style.color = "#e85d8a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
                aria-label={t("common:support.donateAria")}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="#e85d8a" aria-hidden="true">
                  <path d="M8 14s-6-3.9-6-8a4 4 0 0 1 6-3.44A4 4 0 0 1 14 6c0 4.1-6 8-6 8z" />
                </svg>
                {t("common:support.donate")}
              </a>
              <a
                href="https://github.com/Abrechen2/TravStats"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 flex-1 py-1 rounded-sm text-[11px] font-medium transition-colors duration-150"
                style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#f5a623";
                  e.currentTarget.style.color = "#f5a623";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
                aria-label={t("common:support.starAria")}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="#f5a623" aria-hidden="true">
                  <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
                </svg>
                {t("common:support.star")}
              </a>
              <a
                href="https://discord.gg/CRnjB9f78t"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 flex-1 py-1 rounded-sm text-[11px] font-medium transition-colors duration-150"
                style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#5865F2";
                  e.currentTarget.style.color = "#5865F2";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
                aria-label={t("common:accessibility.discord")}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="#5865F2" aria-hidden="true">
                  <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612" />
                </svg>
                Discord
              </a>
            </div>
            <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
              {displayName(user)}
            </div>
            <Link
              to="/settings?tab=general&section=profile"
              onClick={() => setMobileMenuOpen(false)}
              className="btn-secondary w-full text-sm mb-2 block text-center"
            >
              {t("settings:profile.editProfile", { defaultValue: "Profil bearbeiten" })}
            </Link>
            <button
              onClick={() => {
                handleLogout().catch(() => undefined);
                setMobileMenuOpen(false);
              }}
              className="btn-secondary w-full text-sm"
            >
              {t("dashboard:logout")}
            </button>
          </div>
        </div>
      )}

      <DiagnosticExportModal
        isOpen={diagnosticModalOpen}
        onClose={() => setDiagnosticModalOpen(false)}
      />
    </>
  );
}
