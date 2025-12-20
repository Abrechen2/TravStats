import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState, Suspense, lazy } from 'react';
import { useAuthStore } from './store/authStore';
import { logger } from './lib/logger';
import { useSettingsStore } from './store/settingsStore';
import { useThemeStore } from './store/themeStore';
import ErrorBoundary from './components/ErrorBoundary';
import Toast from './components/Toast';
import AirportSeedingBanner from './components/AirportSeedingBanner';
import AirportSeedingModal from './components/AirportSeedingModal';
import { setupApi } from './lib/api';
import i18n from './i18n/config';
import { useTranslation } from './hooks/useTranslation';

// Lazy load pages for code splitting
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const FlightsTablePage = lazy(() => import('./pages/FlightsTablePage'));
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'));
const AdvancedStatsPage = lazy(() => import('./pages/AdvancedStatsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SetupPage = lazy(() => import('./pages/SetupPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const TrainingPage = lazy(() => import('./pages/TrainingPage'));

function AppContent() {
  const { user } = useAuthStore();
  const loadRemoteSettings = useSettingsStore((s) => s.loadRemoteSettings);
  const language = useSettingsStore((s) => s.display.language);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const [setupChecked, setSetupChecked] = useState(false);
  const [showSeedingModal, setShowSeedingModal] = useState(false);

  // Sync language from settings store to i18n
  useEffect(() => {
    if (language) {
      // Always sync, even if it seems to match, to handle edge cases
      const currentLang = i18n.language || i18n.resolvedLanguage;
      if (currentLang !== language) {
        i18n.changeLanguage(language).catch((err) => {
          console.warn('Failed to change language:', err);
        });
      }
    }
  }, [language]);

  // Ensure theme is applied after store rehydration
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [isDarkMode]);

  // Check setup status on app load
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const { requiresSetup } = await setupApi.getStatus();
        if (requiresSetup) {
          navigate('/setup');
        }
      } catch (error) {
        logger.error('Setup status check failed:', error);
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
          if (status && (status.status === 'pending' || status.status === 'running')) {
            // Check if user has already seen the modal (localStorage)
            const hasSeenModal = localStorage.getItem('airport-seeding-modal-seen');
            if (!hasSeenModal) {
              setShowSeedingModal(true);
            }
          }
        } catch (error) {
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
    localStorage.setItem('airport-seeding-modal-seen', 'true');
  };

  // Show loading while checking setup status
  if (!setupChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {t('loading.title')}
          </div>
          <div className="text-gray-600 dark:text-gray-400">
            {t('loading.checkingSystem')}
          </div>
        </div>
      </div>
    );
  }

  const isAuthenticated = !!user;

  const LoadingFallback = () => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {t('loading.title')}
        </div>
        <div className="text-gray-600 dark:text-gray-400">
          {t('loading.pleaseWait')}
        </div>
      </div>
    </div>
  );

  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="max-w-md w-full p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-red-200 dark:border-red-800">
            <div className="text-center">
              <div className="text-6xl mb-4">💥</div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {t('errorBoundary.title')}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                {t('errorBoundary.message')}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                {t('errorBoundary.refresh')}
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
        <Routes>
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

          {/* Protected routes */}
          <Route
            path="/"
            element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />}
          />
          <Route
            path="/flights"
            element={isAuthenticated ? <FlightsTablePage /> : <Navigate to="/login" />}
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
              isAuthenticated && user?.isAdmin
                ? <AdminPage />
                : <Navigate to={isAuthenticated ? "/" : "/login"} />
            }
          />
          <Route
            path="/training"
            element={isAuthenticated ? <TrainingPage /> : <Navigate to="/login" />}
          />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
