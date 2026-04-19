import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { useEffect, useState, Suspense, lazy } from "react";
import { useAuthStore } from "./store/authStore";
import { logger } from "./lib/logger";
import { useSettingsStore } from "./store/settingsStore";
import { useThemeStore } from "./store/themeStore";
import ErrorBoundary from "./components/ErrorBoundary";
import Toast from "./components/Toast";
import AirportSeedingBanner from "./components/AirportSeedingBanner";
import AirportSeedingModal from "./components/AirportSeedingModal";
import { setupApi } from "./lib/api";
import i18n from "./i18n/config";
import { useTranslation } from "./hooks/useTranslation";
import { useEnabledDomains } from "./hooks/useEnabledDomains";

// Lazy load pages for code splitting
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const FlightsTablePage = lazy(() => import("./pages/FlightsTablePage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const AdvancedStatsPage = lazy(() => import("./pages/AdvancedStatsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const SetupPage = lazy(() => import("./pages/SetupPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ParserPage = lazy(() => import("./pages/ParserPage"));
const PendingUpdatesPage = lazy(() => import("./pages/PendingUpdatesPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const ForceChangePasswordPage = lazy(() => import("./pages/ForceChangePasswordPage"));

function LoadingFallback(): JSX.Element {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="text-center">
        <div
          className="text-2xl font-display font-bold mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          Loading...
        </div>
        <div style={{ color: "var(--text-muted)" }}>Please wait...</div>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, _hasHydrated } = useAuthStore();
  const loadRemoteSettings = useSettingsStore((s) => s.loadRemoteSettings);
  const language = useSettingsStore((s) => s.display.language);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation("common");
  const { isEnabled } = useEnabledDomains();
  const [setupChecked, setSetupChecked] = useState(false);
  const [showSeedingModal, setShowSeedingModal] = useState(false);

  // Sync language from settings store to i18n
  useEffect(() => {
    if (language) {
      // Always sync, even if it seems to match, to handle edge cases
      const currentLang = i18n.language || i18n.resolvedLanguage;
      if (currentLang !== language) {
        i18n.changeLanguage(language).catch((err) => {
          logger.warn("Failed to change language:", err);
        });
      }
    }
  }, [language]);

  // Ensure theme is applied after store rehydration
  useEffect(() => {
    if (typeof document !== "undefined") {
      if (isDarkMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [isDarkMode]);

  // Check setup status on app load
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const { requiresSetup } = await setupApi.getStatus();
        if (requiresSetup) {
          navigate("/setup");
        }
      } catch (error) {
        logger.error("Setup status check failed:", error);
      } finally {
        setSetupChecked(true);
      }
    };

    // Always check setup status first
    checkSetup();
  }, [navigate]);

  // Load remote settings only after setup check is complete and user is logged in
  useEffect(() => {
    if (setupChecked && user) {
      loadRemoteSettings();
    }
  }, [setupChecked, user, loadRemoteSettings]);

  // Check if airport seeding is running after login
  useEffect(() => {
    if (user) {
      // Check if airport seeding is running
      const checkSeedingStatus = async () => {
        try {
          const status = await setupApi.getAirportSeedingStatus();
          if (status && (status.status === "pending" || status.status === "running")) {
            // Check if user has already seen the modal (localStorage)
            const hasSeenModal = localStorage.getItem("airport-seeding-modal-seen");
            if (!hasSeenModal) {
              setShowSeedingModal(true);
            }
          }
        } catch {
          // Ignore errors
        }
      };

      // Small delay to ensure login is complete
      const timeout = setTimeout(checkSeedingStatus, 500);
      return () => clearTimeout(timeout);
    }
  }, [user]);

  // Modal schließen und Flag setzen
  const handleCloseSeedingModal = () => {
    setShowSeedingModal(false);
    localStorage.setItem("airport-seeding-modal-seen", "true");
  };

  // Show loading while checking setup status or waiting for auth store hydration
  if (!setupChecked || !_hasHydrated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-base)" }}
      >
        <div className="text-center">
          <div
            className="text-2xl font-display font-bold mb-2"
            style={{ color: "var(--text-primary)" }}
          >
            {t("loading.title")}
          </div>
          <div style={{ color: "var(--text-muted)" }}>{t("loading.checkingSystem")}</div>
        </div>
      </div>
    );
  }

  const isAuthenticated = !!user;

  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary
        fallback={
          <div
            className="min-h-screen flex items-center justify-center"
            style={{ background: "var(--bg-base)" }}
          >
            <div
              className="max-w-md w-full p-8 rounded-xl"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <div className="text-center">
                <div className="text-6xl mb-4">💥</div>
                <h1
                  className="text-2xl font-display font-bold mb-2"
                  style={{ color: "var(--text-primary)" }}
                >
                  {t("errorBoundary.title")}
                </h1>
                <p className="mb-6" style={{ color: "var(--text-muted)" }}>
                  {t("errorBoundary.message")}
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="btn-primary w-full px-6 py-3"
                >
                  {t("errorBoundary.refresh")}
                </button>
              </div>
            </div>
          </div>
        }
      >
        <Toast />
        <AirportSeedingBanner />
        <AirportSeedingModal isOpen={showSeedingModal} onClose={handleCloseSeedingModal} />
        <Suspense fallback={<LoadingFallback />}>
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              {/* Public routes */}
              <Route path="/setup" element={<SetupPage />} />
              <Route
                path="/login"
                element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />}
              />
              <Route
                path="/register"
                element={isAuthenticated ? <Navigate to="/" /> : <RegisterPage />}
              />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/change-password" element={<ForceChangePasswordPage />} />

              {/* Protected routes */}
              <Route
                path="/"
                element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/flights"
                element={
                  isAuthenticated && isEnabled("flight") ? (
                    <FlightsTablePage />
                  ) : (
                    <Navigate to={isAuthenticated ? "/" : "/login"} />
                  )
                }
              />
              <Route
                path="/achievements"
                element={isAuthenticated ? <AchievementsPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/stats"
                element={isAuthenticated ? <AdvancedStatsPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/settings"
                element={isAuthenticated ? <SettingsPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/admin"
                element={
                  isAuthenticated && user?.isAdmin ? (
                    <AdminPage />
                  ) : (
                    <Navigate to={isAuthenticated ? "/" : "/login"} />
                  )
                }
              />
              <Route
                path="/parser"
                element={isAuthenticated ? <ParserPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/pending-updates"
                element={isAuthenticated ? <PendingUpdatesPage /> : <Navigate to="/login" />}
              />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </ErrorBoundary>
    </MotionConfig>
  );
}

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
