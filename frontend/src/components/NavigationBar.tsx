import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { pendingUpdatesApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { useClickOutside } from "../hooks/useClickOutside";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { logger } from "../lib/logger";
import DiagnosticExportModal from "./DiagnosticExportModal";
import { LogoMark, LogoWordmark } from "./Brand/Logo";

interface NavItem {
  path: string;
  label: string;
  show: boolean;
  badge?: number;
  warn?: boolean;
  betaBadge?: boolean;
}

export default function NavigationBar(): JSX.Element {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(["dashboard", "common", "cruise"]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingUpdatesCount, setPendingUpdatesCount] = useState(0);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useClickOutside(mobileMenuRef, closeMobileMenu);
  const { isEnabled } = useEnabledDomains();

  const hasParserAccess = user?.isAdmin ?? false;

  useEffect(() => {
    if (user) {
      const loadPendingCount = async () => {
        try {
          const data = await pendingUpdatesApi.getAll({ status: "pending" });
          setPendingUpdatesCount(data.count || 0);
        } catch {
          logger.warn("Failed to load pending updates count");
        }
      };
      loadPendingCount();
      const interval = setInterval(loadPendingCount, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const isActive = (path: string): boolean => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate("/login");
  };

  const showPendingUpdates = pendingUpdatesCount > 0 || location.pathname === "/pending-updates";

  const navItems: NavItem[] = [
    { path: "/", label: t("dashboard:title"), show: true },
    { path: "/achievements", label: t("dashboard:achievements"), show: true },
    { path: "/stats", label: t("dashboard:stats"), show: true },
    { path: "/flights", label: t("dashboard:flights"), show: isEnabled("flight") },
    { path: "/cruises", label: t("cruise:nav.link"), show: isEnabled("cruise") },
    {
      path: "/pending-updates",
      label: t("dashboard:pendingUpdates"),
      show: showPendingUpdates,
      badge: pendingUpdatesCount,
      warn: true,
    },
    { path: "/settings", label: t("dashboard:settings"), show: true },
    {
      path: "/admin",
      label: t("dashboard:admin"),
      show: user?.isAdmin || false,
    },
    {
      path: "/parser",
      label: t("dashboard:parser"),
      show: hasParserAccess,
      betaBadge: true,
    },
  ].filter((item) => item.show);

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
                aria-label="TravStats — Home"
              >
                <span aria-hidden="true" className="flex items-center gap-2.5">
                  <LogoMark size={26} />
                  <LogoWordmark size={16} />
                </span>
              </Link>
            </div>

            {/* Center: Desktop Navigation */}
            <nav className="hidden xl:flex items-center gap-1">
              {navItems.map((item) => {
                const active = isActive(item.path);
                const hasBadge = (item.badge ?? 0) > 0;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className="relative px-3 py-1.5 text-sm transition-colors duration-200 rounded-md"
                    style={{
                      fontWeight: active ? 600 : 500,
                      color: active
                        ? "var(--accent)"
                        : item.warn
                          ? "var(--warning)"
                          : "var(--text-muted)",
                      background: active ? "var(--bg-elevated)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!active)
                        (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)";
                    }}
                    onMouseLeave={(e) => {
                      if (!active)
                        (e.currentTarget as HTMLAnchorElement).style.color = item.warn
                          ? "var(--warning)"
                          : "var(--text-muted)";
                    }}
                  >
                    {item.label}
                    {item.betaBadge && (
                      <span className="ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium leading-none text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/20">
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
                        {(item.badge ?? 0) > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Right: Donate + Star + Username + Logout */}
            <div className="flex items-center gap-2">
              {/* Bug-Report button — visible on all breakpoints so users can
                  always reach the diagnostic export. Donate / Star stay
                  desktop-only because they're brand vanity, not function. */}
              <button
                type="button"
                onClick={() => setDiagnosticModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors duration-150"
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
              <div className="hidden xl:flex items-center gap-1.5">
                <a
                  href="https://www.paypal.com/donate?hosted_button_id=HW9MPYVURCT42"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors duration-150"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#e85d8a";
                    e.currentTarget.style.color = "#e85d8a";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-border)";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                  aria-label="Donate via PayPal"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="#e85d8a" aria-hidden="true">
                    <path d="M8 14s-6-3.9-6-8a4 4 0 0 1 6-3.44A4 4 0 0 1 14 6c0 4.1-6 8-6 8z" />
                  </svg>
                  Donate
                </a>
                <a
                  href="https://github.com/Abrechen2/TravStats"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors duration-150"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#f5a623";
                    e.currentTarget.style.color = "#f5a623";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-border)";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                  aria-label="Star on GitHub"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="#f5a623" aria-hidden="true">
                    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
                  </svg>
                  Star
                </a>
              </div>
              <span className="hidden xl:inline text-sm" style={{ color: "var(--text-muted)" }}>
                {user?.username}
              </span>
              <button onClick={handleLogout} className="btn-secondary px-3 py-1.5 text-sm">
                {t("dashboard:logout")}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Backdrop */}
      {mobileMenuOpen && (
        <div
          className="xl:hidden fixed inset-0 bg-black/60 z-[55]"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu Panel */}
      {mobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          className="xl:hidden fixed inset-y-0 left-0 w-72 max-w-[calc(100vw-3rem)] z-[60] flex flex-col"
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
            {navItems.map((item) => {
              const active = isActive(item.path);
              const hasBadge = (item.badge ?? 0) > 0;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors"
                  style={{
                    fontWeight: active ? 600 : 500,
                    background: active ? "var(--bg-elevated)" : "transparent",
                    color: active
                      ? "var(--accent)"
                      : item.warn
                        ? "var(--warning)"
                        : "var(--text-muted)",
                    borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {item.label}
                    {item.betaBadge && (
                      <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium leading-none text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/20">
                        Beta
                      </span>
                    )}
                  </span>
                  {hasBadge && (
                    <span
                      className="text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center"
                      style={{ background: "var(--danger)", color: "#fff" }}
                    >
                      {(item.badge ?? 0) > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="p-4" style={{ borderTop: "1px solid var(--color-border)" }}>
            <div className="flex gap-1.5 mb-3">
              <a
                href="https://www.paypal.com/donate?hosted_button_id=HW9MPYVURCT42"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 flex-1 py-1 rounded text-[11px] font-medium transition-colors duration-150"
                style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#e85d8a";
                  e.currentTarget.style.color = "#e85d8a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
                aria-label="Donate via PayPal"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="#e85d8a" aria-hidden="true">
                  <path d="M8 14s-6-3.9-6-8a4 4 0 0 1 6-3.44A4 4 0 0 1 14 6c0 4.1-6 8-6 8z" />
                </svg>
                Donate
              </a>
              <a
                href="https://github.com/Abrechen2/TravStats"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 flex-1 py-1 rounded text-[11px] font-medium transition-colors duration-150"
                style={{ color: "var(--text-muted)", border: "1px solid var(--color-border)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#f5a623";
                  e.currentTarget.style.color = "#f5a623";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
                aria-label="Star on GitHub"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="#f5a623" aria-hidden="true">
                  <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
                </svg>
                Star
              </a>
            </div>
            <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
              {user?.username}
            </div>
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
