import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { settingsApi } from '../lib/api';
import DarkModeToggle from './DarkModeToggle';
import { useTranslation } from '../hooks/useTranslation';
import { useClickOutside } from '../hooks/useClickOutside';
import { logger } from '../lib/logger';

export default function NavigationBar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(['dashboard', 'common']);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const mobileMenuRef = useClickOutside<HTMLDivElement>(() => setMobileMenuOpen(false));

  // Check if user has training access (admin or canTrainLLM)
  const hasTrainingAccess = user?.isAdmin || user?.canTrainLLM || false;

  // Load developer mode status
  useEffect(() => {
    if (hasTrainingAccess) {
      settingsApi
        .getDeveloperMode()
        .then((data) => {
          setDeveloperModeEnabled(data.enabled);
        })
        .catch((error) => {
          // Handle 403 (forbidden) or 401 (unauthorized) errors gracefully
          if (error.response?.status === 403 || error.response?.status === 401) {
            logger.warn('Training access denied or not available:', error);
            setDeveloperModeEnabled(false);
          } else {
            logger.error('Failed to load developer mode status:', error);
          }
        });
    } else {
      setDeveloperModeEnabled(false);
    }
  }, [hasTrainingAccess]);

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };
  const showBackButton = location.pathname !== '/';

  const handleBack = () => {
    navigate('/');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: t('dashboard:title'), icon: '🏠', show: true },
    { path: '/achievements', label: t('dashboard:achievements'), icon: '🏆', show: true },
    { path: '/stats', label: t('dashboard:stats'), icon: '📊', show: true },
    { path: '/settings', label: t('dashboard:settings'), icon: '⚙️', show: true },
    { path: '/admin', label: t('dashboard:admin'), icon: '👑', show: user?.isAdmin || false },
    { path: '/training', label: t('dashboard:training'), icon: '🤖', show: hasTrainingAccess && developerModeEnabled },
  ].filter(item => item.show);

  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700 sticky top-0 z-50">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left side: Logo, Back Button, Mobile Menu */}
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="xl:hidden p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label={t('common:accessibility.toggleMenu')}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            {/* Back Button (only show when not on dashboard) */}
            {showBackButton && (
              <button
                onClick={handleBack}
                className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                aria-label={t('common:accessibility.back')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}

            {/* Logo and App Name */}
            <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt={t('common:app.logoAlt')} className="h-8 w-auto" />
              <h1 className="text-xl font-bold text-gray-900 dark:text-white hidden sm:block">
                {t('common:app.name')}
              </h1>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden xl:flex items-center gap-2">
            {navItems.map((item) => {
              const active = isActive(item.path);
              if (item.path === '/') {
                // Dashboard - special styling
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-4 py-2 rounded-lg font-semibold transition-all text-sm ${
                      active
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {item.icon} {item.label}
                  </Link>
                );
              } else if (item.path === '/achievements') {
                // Achievements - golden gradient
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-4 py-2 rounded-lg font-semibold transition-all text-sm ${
                      active
                        ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-md'
                        : 'bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white shadow-sm hover:shadow-md'
                    }`}
                  >
                    {item.icon} {item.label}
                  </Link>
                );
              } else if (item.path === '/stats') {
                // Stats - blue box like other buttons
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                      active
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                    }`}
                  >
                    {item.icon} {item.label}
                  </Link>
                );
              } else {
                // Other items - gray background
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                      active
                        ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {item.icon} {item.label}
                  </Link>
                );
              }
            })}
          </nav>

          {/* Right side: Welcome, DarkMode, Logout */}
          <div className="flex items-center gap-3">
            {/* Welcome Text (Desktop only) */}
            <span className="hidden xl:inline text-sm text-gray-600 dark:text-gray-300">
              {t('dashboard:welcome', { username: user?.username || '' })}
            </span>

            {/* Dark Mode Toggle */}
            <DarkModeToggle />

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              {t('dashboard:logout')}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="xl:hidden fixed inset-0 bg-black bg-opacity-50 z-40" onClick={() => setMobileMenuOpen(false)} />
      )}
      {mobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          className="xl:hidden fixed inset-y-0 left-0 w-80 bg-white dark:bg-gray-800 z-50 flex flex-col shadow-xl"
        >
          <div className="p-4 border-b dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('dashboard:navigation.title')}
              </h2>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                aria-label={t('common:accessibility.close')}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-2">
              {navItems.map((item) => {
                const active = isActive(item.path);
                if (item.path === '/') {
                  // Dashboard
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold transition-colors ${
                        active
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="text-xl">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                } else if (item.path === '/achievements') {
                  // Achievements - golden gradient
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold transition-all ${
                        active
                          ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-md'
                          : 'bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white shadow-sm'
                      }`}
                    >
                      <span className="text-xl">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                } else if (item.path === '/stats') {
                  // Stats - blue box
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold transition-colors ${
                        active
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                      }`}
                    >
                      <span className="text-xl">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                } else {
                  // Other items (Settings, Admin, Training) - gray background
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold transition-colors ${
                        active
                          ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      <span className="text-xl">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                }
              })}
            </div>

            {/* Mobile Welcome and Logout */}
            <div className="mt-6 pt-6 border-t dark:border-gray-700">
              <div className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 mb-3">
                {t('dashboard:welcome', { username: user?.username || '' })}
              </div>
              <button
                onClick={() => {
                  handleLogout();
                  setMobileMenuOpen(false);
                }}
                className="w-full px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                {t('dashboard:logout')}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

