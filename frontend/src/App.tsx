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
import { setupApi } from "./lib/api";
import i18n from "./i18n/config";
import { useTranslation } from "./hooks/useTranslation";
import { DomainRouteGuard } from "./components/DomainRouteGuard";
import { BetaFeatureRouteGuard } from "./components/BetaFeatureRouteGuard";
import { useWhatsNew } from "./hooks/useWhatsNew";
import { useTelemetryConsentStep } from "./hooks/useTelemetryConsentStep";
import { useSessionValidation } from "./hooks/useSessionValidation";
import WhatsNewModal from "./components/WhatsNewModal";
import UsageStatsConsentDialog from "./components/UsageStatsConsentDialog";

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
import NavigationBar from "./components/NavigationBar";
import { AdminOnlyNotice } from "./components/AdminOnlyNotice";
const LodgingDetailPage = lazy(() => import("./pages/LodgingDetailPage"));
const LodgingChainDetailPage = lazy(() => import("./pages/LodgingChainDetailPage"));
const TripsPage = lazy(() => import("./pages/TripsPage"));
const TripDetailPage = lazy(() => import("./pages/TripDetailPage"));
const TripRouteEditorPage = lazy(() => import("./pages/TripRouteEditorPage"));
const ToursPage = lazy(() => import("./pages/ToursPage"));
const RoadtripsPage = lazy(() => import("./pages/RoadtripsPage"));
const RoadtripDetailPage = lazy(() => import("./pages/RoadtripDetailPage"));
const StravaCallbackPage = lazy(() => import("./pages/StravaCallbackPage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const AdvancedStatsPage = lazy(() => import("./pages/AdvancedStatsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DesignPage = lazy(() => import("./pages/DesignPage"));
const SettingsLegacyRedirect = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsLegacyRedirect }))
);
const SetupPage = lazy(() => import("./pages/SetupPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ParserPage = lazy(() => import("./pages/ParserPage"));
const PendingUpdatesPage = lazy(() => import("./pages/PendingUpdatesPage"));
const AircraftPage = lazy(() => import("./pages/AircraftPage"));
const PassportPage = lazy(() => import("./pages/PassportPage"));
const WrappedPage = lazy(() => import("./pages/WrappedPage"));
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
  // A persisted user is only a CLAIM until the server confirms the cookie.
  // Nothing authenticated may be fetched or rendered before it does — hence
  // every authenticated effect below is gated on `sessionChecked`, not just
  // the render.
  const { sessionChecked } = useSessionValidation();
  const sessionConfirmed = isAuthenticated && sessionChecked;
  const { entry, shouldShow, checked: whatsNewChecked, dismiss } = useWhatsNew(sessionConfirmed);
  const [setupChecked, setSetupChecked] = useState(false);
  const [showSeedingModal, setShowSeedingModal] = useState(false);

  // Usage-stats consent is instance-wide, so only an admin may answer it, and
  // since 2026-09-20 (owner decision) it is a step of its own rather than a
  // card inside the what's-new dialog — which people dismiss reflexively.
  const consentStep = useTelemetryConsentStep({
    isAdminSession: sessionConfirmed && Boolean(user?.isAdmin),
    whatsNewChecked,
    whatsNewOpen: shouldShow,
  });

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
                <h1 className="t-screen-title mb-2">{t("errorBoundary.title")}</h1>
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
        <WhatsNewModal isOpen={shouldShow} entry={entry} onClose={() => void dismiss()} />
        <UsageStatsConsentDialog isOpen={consentStep.shouldShow} onClose={consentStep.close} />
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
                  isAuthenticated ? (
                    <DomainRouteGuard domain="flight">
                      <FlightDetailPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
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
                  isAuthenticated ? (
                    <DomainRouteGuard domain="cruise">
                      <CruiseDetailPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
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
                  isAuthenticated ? (
                    <DomainRouteGuard domain="lodging">
                      <LodgingDetailPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/lodging/chains/:id"
                element={
                  isAuthenticated ? (
                    <DomainRouteGuard domain="lodging">
                      <LodgingChainDetailPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
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
              {/* Tours, across every trip and none. A tour may belong to no
                  trip at all since 2026-09-21, and then this list is the only
                  place it can be reached from. */}
              {/* Tours sit behind the same beta key as roadtrips since
                  2026-09-24 (owner): day tours and roadtrips are one feature
                  in review, and one switch lets them in or out together. */}
              <Route
                path="/tours"
                element={
                  isAuthenticated ? (
                    <BetaFeatureRouteGuard feature="roadtrips" redirectTo="/trips">
                      <ToursPage />
                    </BetaFeatureRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              {/* Strava's consent page returns here (2.7) — a page, not an API
                  route, because the strict auth cookie is not on that
                  cross-site redirect; this page's own request is same-site. */}
              <Route
                path="/integrations/strava/callback"
                element={isAuthenticated ? <StravaCallbackPage /> : <Navigate to="/login" />}
              />
              {/* Roadtrips (2.7). The domain guard is also the beta gate:
                  `useEnabledDomains` drops `roadtrip` while the instance's
                  beta switch is closed. */}
              <Route
                path="/roadtrips"
                element={
                  isAuthenticated ? (
                    <DomainRouteGuard domain="roadtrip">
                      <RoadtripsPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/roadtrips/:id"
                element={
                  isAuthenticated ? (
                    <DomainRouteGuard domain="roadtrip">
                      <RoadtripDetailPage />
                    </DomainRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              {/* The SAME editor as the trip-bound path below: a tour with no
                  trip has no id to put in the URL, and every endpoint it uses
                  answers under both shapes (`sectionPath` in
                  `lib/api/tours.ts`). */}
              <Route
                path="/tours/:routeId"
                element={
                  isAuthenticated ? (
                    <BetaFeatureRouteGuard feature="roadtrips" redirectTo="/trips">
                      <TripRouteEditorPage />
                    </BetaFeatureRouteGuard>
                  ) : (
                    <Navigate to="/login" />
                  )
                }
              />
              <Route
                path="/trips/:id/route/:routeId"
                element={
                  // Back behind the switch on 2026-09-24 (owner), under the
                  // roadtrips key. The guard renders a loading state for the one
                  // request where the flag is still unknown, then lets in or
                  // redirects — never a flash of the editor on production.
                  isAuthenticated ? (
                    <BetaFeatureRouteGuard feature="roadtrips" redirectTo="/trips">
                      <TripRouteEditorPage />
                    </BetaFeatureRouteGuard>
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
              {/* One route per settings group since 2.7.0 (owner decision 11).
                  `/settings` itself is the legacy entry: every `?section=` and
                  `?tab=` link ever written still resolves through it. */}
              <Route
                path="/settings"
                element={isAuthenticated ? <SettingsLegacyRedirect /> : <Navigate to="/login" />}
              />
              <Route
                path="/settings/:group"
                element={isAuthenticated ? <SettingsPage /> : <Navigate to="/login" />}
              />
              {/* The design system's acceptance surface: every primitive in
                  every state. Mounted only in a dev build — not hidden behind a
                  flag but genuinely absent from a production bundle, because a
                  page whose copy is untranslated on purpose has no business
                  being reachable on someone's instance. */}
              {import.meta.env.DEV && <Route path="/design" element={<DesignPage />} />}
              <Route
                path="/admin"
                element={
                  !isAuthenticated ? (
                    <Navigate to="/login" />
                  ) : user?.isAdmin ? (
                    <AdminPage />
                  ) : (
                    // A signed-in reader who is not an admin used to be bounced
                    // to the dashboard without a word, so an admin link from a
                    // changelog or a forum post looked like a broken address
                    // (forgejo#88 finding 7). The API's 403 is right; this is
                    // the UI finally saying the same thing.
                    <>
                      <NavigationBar />
                      <AdminOnlyNotice />
                    </>
                  )
                }
              />
              <Route
                path="/parser"
                element={
                  isAuthenticated ? (
                    // Out of the beta registry on 2026-09-17, on the owner's
                    // decision: the gate's condition was "the template and
                    // regex parsers are tested against the sample set", and
                    // they are — 31 of 31 flight mails, 97 of 108 lodging,
                    // 4 of 4 cruise, every expectation met without an LLM
                    // (scripts/parser-corpus.ts --regex-only, forgejo#122).
                    // The page is admin-only through the menu, as before.
                    <ParserPage />
                  ) : (
                    <Navigate to="/login" />
                  )
                }
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
              {/* Beside the passport, NOT under `/stats` — and the navigation
                  is the reason it is a top-level path rather than a tidy one.
                  `isPathActive` marks a parent active for its children, so
                  `/stats/wrapped` lit up the Statistik entry AND this leaf at
                  the same time: two destinations highlighted, one of them the
                  page the reader was not on. Both pages are a reading of the
                  whole logbook rather than a tab of the statistics page, so
                  the flat path is also the truer one. */}
              <Route
                path="/wrapped"
                element={isAuthenticated ? <WrappedPage /> : <Navigate to="/login" />}
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
