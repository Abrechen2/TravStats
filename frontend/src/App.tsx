import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import AchievementsPage from './pages/AchievementsPage';
import AdvancedStatsPage from './pages/AdvancedStatsPage';
import SettingsPage from './pages/SettingsPage';
import { useSettingsStore } from './store/settingsStore';


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
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />}
        />
        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to="/" /> : <RegisterPage />}
        />
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
      </Routes>
    </BrowserRouter>
  );
}

export default App;
