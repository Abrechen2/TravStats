import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { useEffect, useState, Suspense, lazy } from "react";
import { useAuthStore } from "./store/authStore";
import { logger } from "./lib/logger";
import { useSettingsStore } from "./store/settingsStore";
import ErrorBoundary from "./components/ErrorBoundary";
import Toast from "./components/Toast";
import AirportSeedingBanner from "./components/AirportSeedingBanner";
import AirportSeedingModal from "./components/AirportSeedingModal";
import { setupApi, usageStatsApi } from "./lib/api";
import i18n from "./i18n/config";
import { useTranslation } from "./hooks/useTranslation";
import { useEnabledDomains } from "./hooks/useEnabledDomains";
import { DomainRouteGuard } from "./components/DomainRouteGuard";
import { useWhatsNew } from "./hooks/useWhatsNew";
import { useSessionValidation } from "./hooks/useSessionValidation";
import WhatsNewModal from "./components/WhatsNewModal";
import UsageStatsConsentCard from "./components/UsageStatsConsentCard";

// Lazy load pages for code splitting
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const FlightsTablePage = lazy(() => import("./pages/FlightsTablePage"));
const FlightDetailPage = lazy(() => import("./pages/FlightDetailPage"));
const CruisesPage = lazy(() => import("./pages/CruisesPage"));
const CruiseDetailPage = lazy(() => import("./pages/CruiseDetailPage"));
const LodgingListPage = lazy(() => import("./pages/LodgingListPage"));
const PlacesListPage = lazy(() => import("./pages/PlacesListPage"));
const PlaceDetailPage = lazy(() => import("./pages/PlaceDetailPage"));
const PlaceListsPage = lazy(() => import("./pages/PlaceListsPage"));
const PlaceListDetailPage = lazy(() => import("./pages/PlaceListDetailPage"));
const CuratedChecklistPage = lazy(() => import("./pages/CuratedChecklistPage"));
import { PlacesRouteGuard } from "./components/places/PlacesRouteGuard";
import { TripRouteGuard } from "./components/Trips/TripRouteGuard";
const LodgingDetailPage = lazy(() => import("./pages/LodgingDetailPage"));
const LodgingChainDetailPage = lazy(() => import("./pages/LodgingChainDetailPage"));
const TripsPage = lazy(() => import("./pages/TripsPage"));
const TripDetailPage = lazy(() => import("./pages/TripDetailPage"));
const TripRouteEditorPage = lazy(() => import("./pages/TripRouteEditorPage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const AdvancedStatsPage = lazy(() => import("./pages/AdvancedStatsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const SetupPage = lazy(() => import("./pages/SetupPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ParserPage = lazy(() => import("./pages/ParserPage"));
const PendingUpdatesPage = lazy(() => import("./pages/PendingUpdatesPage"));
const AircraftPage = lazy(() => import("./pages/AircraftPage"));
const PassportPage = lazy(() => import("./pages/PassportPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const ForceChangePasswordPage = lazy(() => import("./pages/ForceChangePasswordPage"));
const TwoFactorChallengePage = lazy(() => import("./pages/TwoFactorChallengePage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

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
  const isAuthenticated = !!user;
  const loadRemoteSettings = useSettingsStore((s) => s.loadRemoteSettings);
  const language = useSettingsStore((s) => s.display.language);
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation("common");
  const { isEnabled } = useEnabledDomains();
  // A persisted user is only a CLAIM until the server confirms the cookie.
  // Nothing authenticated may be fetched or rendered before it does — hence
  // every authenticated effect below is gated on `sessionChecked`, not just
  // the render.
  const { sessionChecked } = useSessionValidation();
  const sessionConfirmed = isAuthenticated && sessionChecked;
  const { entry, shouldShow, dismiss } = useWhatsNew(sessionConfirmed);
  const [setupChecked, setSetupChecked] = useState(false);
  const [showSeedingModal, setShowSeedingModal] = useState(false);
  const [consentPending, setConsentPending] = useState(false);

  // Usage-stats consent is instance-wide: only offer it to admins, and only while
  // it is still undecided. Fetch failures must never surface the card.
  useEffect(() => {
    if (!sessionConfirmed || !user?.isAdmin) return;
    let cancelled = false;
    void usageStatsApi
      .get()
      .then((status) => {
        if (!cancelled) setConsentPending(status.consent === "unset");
      })
      .catch(() => {
        if (!cancelled) setConsentPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionConfirmed, user?.isAdmin]);

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
    if (setupChecked && sessionConfirmed) {
      loadRemoteSettings();
    }
  }, [setupChecked, sessionConfirmed, loadRemoteSettings]);

  // Check if airport seeding is running after login
  useEffect(() => {
    if (sessionConfirmed) {
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
  }, [sessionConfirmed]);

  // Modal schließen und Flag setzen
  const handleCloseSeedingModal = () => {
    setShowSeedingModal(false);
    localStorage.setItem("airport-seeding-modal-seen", "true");
  };

  // Show loading while checking setup status, waiting for auth store hydration,
  // or verifying a persisted session against the server.
  if (!setupChecked || !_hasHydrated || !sessionChecked) {
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
        <WhatsNewModal
          isOpen={shouldShow}
          entry={entry}
          onClose={() => void dismiss()}
          extraSlot={
            consentPending ? (
              <UsageStatsConsentCard onDecided={() => setConsentPending(false)} />
            ) : undefined
          }
        />
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
              <Route path="/2fa" element={<TwoFactorChallengePage />} />

              {/* Protected routes */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route
                path="/dashboard"
                element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/dashboard/:tab"
                element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/flights"
                element={
                  isAuthenticated ? (
                    // Not a boolean guard — see DomainRouteGuard: the domain
                    // list is unknown for one request on a cold load, and
                    // deciding then bounced every bookmark and refresh.
                    <DomainRouteGuard domain="flight">
                      <FlightsTablePage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/flights/:id"
                element={
                  isAuthenticated && isEnabled("flight") ? (
                    <FlightDetailPage />
                  ) : (
                    <Navigate to={isAuthenticated ? "/" : "/login"} />
                  )
                }
              />
              <Route
                path="/cruises"
                element={
                  isAuthenticated ? (
                    // Not a boolean guard — see DomainRouteGuard: the domain
                    // list is unknown for one request on a cold load, and
                    // deciding then bounced every bookmark and refresh.
                    <DomainRouteGuard domain="cruise">
                      <CruisesPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/cruises/:id"
                element={
                  isAuthenticated && isEnabled("cruise") ? (
                    <CruiseDetailPage />
                  ) : (
                    <Navigate to={isAuthenticated ? "/" : "/login"} />
                  )
                }
              />
              <Route
                path="/lodging"
                element={
                  isAuthenticated ? (
                    // Not a boolean guard — see DomainRouteGuard: the domain
                    // list is unknown for one request on a cold load, and
                    // deciding then bounced every bookmark and refresh.
                    <DomainRouteGuard domain="lodging">
                      <LodgingListPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/places"
                element={
                  isAuthenticated ? (
                    // Not a boolean guard: the beta flag is unknown for one
                    // request on a cold load, and redirecting on "unknown"
                    // bounced every refresh and bookmark. See PlacesRouteGuard.
                    <PlacesRouteGuard>
                      <PlacesListPage />
                    </PlacesRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              {/* Static segments before the dynamic one. React Router ranks
                  them higher regardless of order, but keeping them adjacent is
                  what makes the relationship readable — a place can never be
                  shadowed by being named "lists". */}
              <Route
                path="/places/lists"
                element={
                  isAuthenticated ? (
                    <PlacesRouteGuard>
                      <PlaceListsPage />
                    </PlacesRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/places/lists/:id"
                element={
                  isAuthenticated ? (
                    <PlacesRouteGuard>
                      <PlaceListDetailPage />
                    </PlacesRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/places/checklists/:key"
                element={
                  isAuthenticated ? (
                    <PlacesRouteGuard>
                      <CuratedChecklistPage />
                    </PlacesRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/places/:id"
                element={
                  isAuthenticated ? (
                    // Not a boolean guard: the beta flag is unknown for one
                    // request on a cold load, and redirecting on "unknown"
                    // bounced every refresh and bookmark. See PlacesRouteGuard.
                    <PlacesRouteGuard>
                      <PlaceDetailPage />
                    </PlacesRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/lodging/:id"
                element={
                  isAuthenticated && isEnabled("lodging") ? (
                    <LodgingDetailPage />
                  ) : (
                    <Navigate to={isAuthenticated ? "/" : "/login"} />
                  )
                }
              />
              <Route
                path="/lodging/chains/:id"
                element={
                  isAuthenticated && isEnabled("lodging") ? (
                    <LodgingChainDetailPage />
                  ) : (
                    <Navigate to={isAuthenticated ? "/" : "/login"} />
                  )
                }
              />
              <Route
                path="/trips"
                element={isAuthenticated ? <TripsPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/trips/:id"
                element={isAuthenticated ? <TripDetailPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/trips/:id/route/:routeId"
                element={
                  // Gated the same way the Touren tab is gated
                  // (`isFeatureVisible("tourRoutes")` in TripDetailPage) —
                  // otherwise the editor stays reachable by URL with the tab,
                  // and thus the flag, hidden. NOT a boolean guard: the beta
                  // flag is unknown for one request on a cold load, and
                  // redirecting on "unknown" bounced every refresh and
                  // bookmark of this URL to /trips. See TripRouteGuard and
                  // PlacesRouteGuard (same fix, same reason).
                  isAuthenticated ? (
                    <TripRouteGuard>
                      <TripRouteEditorPage />
                    </TripRouteGuard>
                  ) : (
                    <Navigate to="/login" />
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
              <Route
                path="/aircraft/:registration"
                element={isAuthenticated ? <AircraftPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/passport"
                element={isAuthenticated ? <PassportPage /> : <Navigate to="/login" />}
              />
              <Route
                path="*"
                element={isAuthenticated ? <NotFoundPage /> : <Navigate to="/login" replace />}
              />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </ErrorBoundary>
    </MotionConfig>
  );
}

// The v7_startTransition / v7_relativeSplatPath opt-ins that used to sit on
// BrowserRouter are gone in react-router 7 — both are its default behaviour.
function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
