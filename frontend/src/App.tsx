import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import AchievementsPage from './pages/AchievementsPage';
import AdvancedStatsPage from './pages/AdvancedStatsPage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';
import AdminPage from './pages/AdminPage';
import { useSettingsStore } from './store/settingsStore';
import ErrorBoundary from './components/ErrorBoundary';


function App() {
  const { user } = useAuthStore();
  const loadRemoteSettings = useSettingsStore((s) => s.loadRemoteSettings);

  useEffect(() => {
    if (user) {
      loadRemoteSettings();
    }
  }, [user, loadRemoteSettings]);

  const isAuthenticated = !!user;

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
      <BrowserRouter>
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
          element={isAuthenticated ? <AdminPage /> : <Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
