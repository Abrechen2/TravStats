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
  const { token } = useAuthStore();
  const loadRemoteSettings = useSettingsStore((s) => s.loadRemoteSettings);

  useEffect(() => {
    if (token) {
      loadRemoteSettings();
    }
  }, [token, loadRemoteSettings]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={token ? <Navigate to="/" /> : <LoginPage />}
        />
        <Route
          path="/register"
          element={token ? <Navigate to="/" /> : <RegisterPage />}
        />
        <Route
          path="/"
          element={token ? <DashboardPage /> : <Navigate to="/login" />}
        />
        <Route
          path="/achievements"
          element={token ? <AchievementsPage /> : <Navigate to="/login" />}
        />
        <Route
          path="/stats"
          element={token ? <AdvancedStatsPage /> : <Navigate to="/login" />}
        />
        <Route
          path="/settings"
          element={token ? <SettingsPage /> : <Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
