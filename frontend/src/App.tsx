import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState, Suspense, lazy } from 'react';
import { useAuthStore } from './store/authStore';
import { logger } from './lib/logger';
import { useSettingsStore } from './store/settingsStore';
import { useThemeStore } from './store/themeStore';
import ErrorBoundary from './components/ErrorBoundary';
import Toast from './components/Toast';
import { setupApi } from './lib/api';

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
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const navigate = useNavigate();
  const [setupChecked, setSetupChecked] = useState(false);

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

    // Only check if not logged in
    if (!user) {
      checkSetup();
    } else {
      setSetupChecked(true);
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user) {
      loadRemoteSettings();
    }
  }, [user, loadRemoteSettings]);

  // Show loading while checking setup status
  if (!setupChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Loading...
          </div>
          <div className="text-gray-600 dark:text-gray-400">
            Checking system status
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
          Loading...
        </div>
        <div className="text-gray-600 dark:text-gray-400">
          Please wait
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
                Oops! Something went wrong
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                The application encountered an unexpected error. Please try refreshing the page.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      }
    >
      <Toast />
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
