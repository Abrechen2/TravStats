import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import NavigationBar from '../components/NavigationBar';
import InlineHelp from '../components/Help/InlineHelp';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import ParserConfiguration from '../components/Settings/ParserConfiguration';
import ApiKeyCard from '../components/Settings/ApiKeyCard';
import { settingsApi, authApi, backupApi, pendingUpdatesApi } from '../lib/api';
import { useToastStore } from '../store/toastStore';
import { logger } from '../lib/logger';
import { useTranslation } from '../hooks/useTranslation';
import { changeLanguage } from '../i18n/config';

const timezoneOptions = [
  'Europe/Berlin',
  'Europe/Paris',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Singapore',
];

const colorPresets = ['#2563eb', '#16a34a', '#f97316', '#7c3aed', '#e11d48'];

export default function SettingsPage() {
  const { t } = useTranslation(['settings', 'common']);
  const { user } = useAuthStore();
  const {
    profile,
    display,
    units,
    defaults,
    map,
    notifications,
    privacy,
    backup,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    setNotifications,
    setPrivacy,
    setBackup,
    saveRemoteSettings,
  } = useSettingsStore();

  const { isDarkMode, setDarkMode } = useThemeStore();
  const addToast = useToastStore((state) => state.addToast);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [showDeveloperConfirm, setShowDeveloperConfirm] = useState(false);
  const [loadingDeveloperMode, setLoadingDeveloperMode] = useState(false);
  const [uploadingProfilePicture, setUploadingProfilePicture] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState('');
  const [lastBackup, setLastBackup] = useState<any>(null);
  const [backupStatus, setBackupStatus] = useState<{ running: boolean } | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [trainingSettings, setTrainingSettings] = useState({
    useTrainedModels: true,
    preferredEmailModel: 'auto' as 'auto' | 'trained' | 'base',
    preferredVisionModel: 'auto' as 'auto' | 'trained' | 'base',
    trainingSeparateModels: true,
  });
  const [loadingTrainingSettings, setLoadingTrainingSettings] = useState(false);
  const [autoUpdateSettings, setAutoUpdateSettings] = useState({
    enabled: false,
    requireApproval: true,
    checkInterval: 15,
    onlyDuringFlight: true,
    expiryHours: 24,
  });
  const [loadingAutoUpdateSettings, setLoadingAutoUpdateSettings] = useState(false);
  const [apiKeysStatus, setApiKeysStatus] = useState<{
    openai: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    claude: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    airlabs: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    aviationstack: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  } | null>(null);
  const [apiKeys, setApiKeys] = useState({
    openaiApiKey: '',
    claudeApiKey: '',
    airlabsApiKey: '',
    aviationstackApiKey: '',
    openskyClientId: '',
    openskyClientSecret: '',
  });
  const [loadingApiKeys, setLoadingApiKeys] = useState(false);

  // Check if user has training access (admin or canTrainLLM)
  const hasTrainingAccess = user?.isAdmin || user?.canTrainLLM || false;

  // Load training settings
  useEffect(() => {
    const loadTrainingSettings = async () => {
      try {
        const data = await settingsApi.getTrainingSettings();
        setTrainingSettings({
          useTrainedModels: data.useTrainedModels,
          preferredEmailModel: data.preferredEmailModel,
          preferredVisionModel: data.preferredVisionModel,
          trainingSeparateModels: data.trainingSeparateModels,
        });
      } catch (error) {
        logger.error('Failed to load training settings:', error);
      }
    };
    loadTrainingSettings();
  }, []);

  // Load auto-update settings
  useEffect(() => {
    const loadAutoUpdateSettings = async () => {
      try {
        const settings = await settingsApi.get();
        if (settings.autoUpdate) {
          setAutoUpdateSettings({
            enabled: settings.autoUpdate.enabled ?? false,
            requireApproval: settings.autoUpdate.requireApproval ?? true,
            checkInterval: settings.autoUpdate.checkInterval ?? 15,
            onlyDuringFlight: settings.autoUpdate.onlyDuringFlight ?? true,
            expiryHours: settings.autoUpdate.expiryHours ?? 24,
          });
        }
      } catch (error) {
        logger.error('Failed to load auto-update settings:', error);
      }
    };
    loadAutoUpdateSettings();
    
    // Load API keys status
    const loadApiKeysStatus = async () => {
      try {
        const status = await settingsApi.getApiKeys();
        setApiKeysStatus(status);
      } catch (error) {
        logger.error('Failed to load API keys status:', error);
      }
    };
    loadApiKeysStatus();
  }, []);

  // Save auto-update settings
  const saveAutoUpdateSettings = async () => {
    try {
      setLoadingAutoUpdateSettings(true);
      await settingsApi.update({
        autoUpdate: autoUpdateSettings,
      });
      addToast({
        type: 'success',
        message: t('settings:autoUpdate.saved') || 'Auto-Update-Einstellungen gespeichert',
      });
    } catch (error) {
      logger.error('Failed to save auto-update settings:', error);
      addToast({
        type: 'error',
        message: t('settings:autoUpdate.saveFailed') || 'Fehler beim Speichern',
      });
    } finally {
      setLoadingAutoUpdateSettings(false);
    }
  };

  // Auto-save units settings when they change
  useEffect(() => {
    const saveSettings = async () => {
      try {
        await saveRemoteSettings();
      } catch (error) {
        logger.error('Failed to save units settings:', error);
        addToast('error', t('settings:errors.saveFailed') || 'Failed to save settings');
      }
    };

    // Debounce: Warte 500ms nach letzter Änderung
    const timeoutId = setTimeout(saveSettings, 500);
    return () => clearTimeout(timeoutId);
  }, [units, saveRemoteSettings, addToast, t]);

  const handleTrainingSettingsUpdate = async () => {
    setLoadingTrainingSettings(true);
    try {
      await settingsApi.updateTrainingSettings(trainingSettings);
      addToast('success', t('settings:training.updated'));
    } catch (error) {
      logger.error('Failed to update training settings:', error);
      addToast('error', t('settings:training.updateFailed'));
    } finally {
      setLoadingTrainingSettings(false);
    }
  };

  // Load backup info
  useEffect(() => {
    if (user?.isAdmin) {
      const loadBackupInfo = async () => {
        try {
          const [backupsData, statusData] = await Promise.all([
            backupApi.list(),
            backupApi.getStatus(),
          ]);
          
          const completedBackups = backupsData.backups.filter((b: any) => b.status === 'completed');
          if (completedBackups.length > 0) {
            setLastBackup(completedBackups[0]);
          }
          setBackupStatus(statusData);
        } catch (error) {
          logger.error('Failed to load backup info:', error);
        }
      };
      loadBackupInfo();
      const interval = setInterval(loadBackupInfo, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [user]);

  // Load developer mode status
  useEffect(() => {
    if (hasTrainingAccess) {
      settingsApi
        .getDeveloperMode()
        .then((data) => {
          setDeveloperModeEnabled(data.enabled);
        })
        .catch((error: any) => {
          // Handle 403 (forbidden) or 401 (unauthorized) errors gracefully
          if (error.response?.status === 403 || error.response?.status === 401) {
            logger.warn('Training access denied or not available:', error);
            // Don't show error to user, just don't enable developer mode
            setDeveloperModeEnabled(false);
          } else {
            logger.error('Failed to load developer mode status:', error);
          }
        });
    } else {
      // Reset developer mode if user doesn't have access
      setDeveloperModeEnabled(false);
    }
  }, [hasTrainingAccess]);

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      addToast('error', t('settings:profile.invalidFileType'));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      addToast('error', t('settings:profile.fileTooLarge'));
      return;
    }

    setUploadingProfilePicture(true);
    try {
      const result = await settingsApi.uploadProfilePicture(file);
      setProfile({ profilePicture: result.profilePictureUrl });
      addToast('success', t('settings:profile.uploadSuccess'));
    } catch (error: any) {
      logger.error('Failed to upload profile picture:', error);
      addToast('error', error.response?.data?.error || t('settings:profile.uploadError'));
      // Fallback: show local preview
      const url = URL.createObjectURL(file);
      setProfile({ profilePicture: url });
    } finally {
      setUploadingProfilePicture(false);
      // Reset input
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleThemeToggle = () => {
    const nextIsDark = !isDarkMode;
    setDarkMode(nextIsDark);
    setDisplay({ theme: nextIsDark ? 'dark' : 'light' });
  };

  const handleDeveloperModeToggle = () => {
    if (!developerModeEnabled) {
      // Show confirmation dialog
      setShowDeveloperConfirm(true);
    } else {
      // Disable directly
      handleDeveloperModeConfirm(false);
    }
  };

  const handleDeveloperModeConfirm = async (enabled: boolean) => {
    setLoadingDeveloperMode(true);
    setShowDeveloperConfirm(false);

    try {
      await settingsApi.updateDeveloperMode({
        enabled,
        confirmed: enabled,
      });
      setDeveloperModeEnabled(enabled);
    } catch (error) {
      logger.error('Failed to update developer mode:', error);
      alert(t('settings:developer.updateError'));
    } finally {
      setLoadingDeveloperMode(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError('');

    // Validation
    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError(t('common:messages.error'));
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordError(t('common:messages.error'));
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError(t('common:messages.error'));
      return;
    }

    if (passwordForm.oldPassword === passwordForm.newPassword) {
      setPasswordError(t('common:messages.error'));
      return;
    }

    setChangingPassword(true);

    try {
      await authApi.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      addToast('success', t('settings:password.success'));
      setShowPasswordModal(false);
      setPasswordForm({
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error: any) {
      logger.error('Failed to change password:', error);
      setPasswordError(error.response?.data?.error || t('settings:password.error'));
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <NavigationBar />
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:roadmap')}</p>
            <h1 className="text-3xl font-bold">{t('settings:title')}</h1>
            <p className="text-gray-500 dark:text-gray-400">{t('settings:subtitle')}</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile */}
          <div className="card lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t('settings:profile.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('settings:profile.description')}
                </p>
              </div>
              <button
                onClick={() => setShowPasswordModal(true)}
                className="btn-secondary"
              >
                {t('settings:profile.changePassword')}
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl font-bold text-white">
                {profile.profilePicture ? (
                  <img
                    src={profile.profilePicture}
                    alt={t('settings:profile.title')}
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  profile.username.charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <label className="label">{t('settings:profile.uploadAvatar')}</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  disabled={uploadingProfilePicture}
                  className="text-sm text-gray-600 dark:text-gray-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('settings:profile.username')}</label>
                <input
                  type="text"
                  value={profile.username}
                  onChange={(e) => setProfile({ username: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">{t('settings:profile.email')}</label>
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile({ email: e.target.value })}
                  className="input"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn-danger"
                onClick={() => setPrivacy({ accountDeletionRequested: true })}
              >
                {t('settings:profile.deleteAccount')}
              </button>
              {privacy.accountDeletionRequested && (
                <span className="text-sm text-red-500">{t('settings:profile.deletionRequested')}</span>
              )}
            </div>
          </div>

          {/* Display & Locale */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t('settings:display.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:display.description')}</p>
              </div>
              <button
                onClick={handleThemeToggle}
                className={`px-3 py-2 rounded-lg border text-sm ${
                  isDarkMode
                    ? 'bg-gray-800 text-yellow-400 border-gray-700'
                    : 'bg-gray-100 text-gray-800 border-gray-200'
                }`}
              >
                {display.theme === 'dark' 
                  ? `${t('settings:display.theme.darkMode')} ${t('settings:display.theme.active')}`
                  : `${t('settings:display.theme.lightMode')} ${t('settings:display.theme.active')}`
                }
              </button>
            </div>

            <InlineHelp
              title={t('settings:display.theme.title')}
              category="basic"
              content={
                <div className="space-y-2">
                  <p>
                    {t('settings:display.theme.description')}
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                    <li>
                      <strong>{t('settings:display.theme.lightMode')}:</strong> {t('settings:display.theme.lightDescription')}
                    </li>
                    <li>
                      <strong>{t('settings:display.theme.darkMode')}:</strong> {t('settings:display.theme.darkDescription')}
                    </li>
                    <li>
                      {t('settings:display.theme.autoSave')}
                    </li>
                  </ul>
                </div>
              }
            />

            <div>
              <label className="label">{t('settings:display.language')}</label>
              <select
                value={display.language}
                onChange={(e) => {
                  const newLang = e.target.value as 'de' | 'en';
                  // changeLanguage is async but we don't need to await here
                  // as the UI will re-render automatically when i18n updates
                  void changeLanguage(newLang);
                }}
                className="input"
              >
                <option value="de">{t('settings:display.languages.de')}</option>
                <option value="en">{t('settings:display.languages.en')}</option>
              </select>
            </div>

            <div>
              <label className="label">{t('settings:display.timezone')}</label>
              <select
                value={display.timezone}
                onChange={(e) => setDisplay({ timezone: e.target.value })}
                className="input"
              >
                {timezoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t('settings:display.dateFormat')}</label>
                <select
                  value={display.dateFormat}
                  onChange={(e) => setDisplay({ dateFormat: e.target.value as typeof display.dateFormat })}
                  className="input"
                >
                  <option value="DD.MM.YYYY">DD.MM.YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>
              <div>
                <label className="label">{t('settings:display.timeFormat')}</label>
                <select
                  value={display.timeFormat}
                  onChange={(e) => setDisplay({ timeFormat: e.target.value as typeof display.timeFormat })}
                  className="input"
                >
                  <option value="24h">24h</option>
                  <option value="12h">12h AM/PM</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Units */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t('settings:units.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:units.description')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t('settings:units.distance')}</label>
                <select
                  value={units.distanceUnit}
                  onChange={(e) => setUnits({ distanceUnit: e.target.value as typeof units.distanceUnit })}
                  className="input"
                >
                  <option value="kilometers">{t('settings:units.options.kilometers')}</option>
                  <option value="miles">{t('settings:units.options.miles')}</option>
                  <option value="nautical_miles">{t('settings:units.options.nautical_miles')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('settings:units.currency')}</label>
                <select
                  value={units.currency}
                  onChange={(e) => setUnits({ currency: e.target.value as typeof units.currency })}
                  className="input"
                >
                  <option value="EUR">{t('settings:units.options.EUR')}</option>
                  <option value="USD">{t('settings:units.options.USD')}</option>
                  <option value="GBP">{t('settings:units.options.GBP')}</option>
                  <option value="CHF">{t('settings:units.options.CHF')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Defaults */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t('settings:defaults.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:defaults.description')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t('settings:defaults.flightStatus')}</label>
                <select
                  value={defaults.flightStatus}
                  onChange={(e) => setDefaults({ flightStatus: e.target.value as typeof defaults.flightStatus })}
                  className="input"
                >
                  <option value="scheduled">{t('settings:defaults.options.scheduled')}</option>
                  <option value="flown">{t('settings:defaults.options.flown')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('settings:defaults.seatClass')}</label>
                <select
                  value={defaults.seatClass}
                  onChange={(e) => setDefaults({ seatClass: e.target.value as typeof defaults.seatClass })}
                  className="input"
                >
                  <option value="economy">{t('settings:defaults.options.economy')}</option>
                  <option value="premium_economy">{t('settings:defaults.options.premium_economy')}</option>
                  <option value="business">{t('settings:defaults.options.business')}</option>
                  <option value="first">{t('settings:defaults.options.first')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('settings:defaults.favoriteAirline')}</label>
                <input
                  type="text"
                  value={defaults.favoriteAirline}
                  onChange={(e) => setDefaults({ favoriteAirline: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">{t('settings:defaults.flightCategory')}</label>
                <select
                  value={defaults.flightCategory}
                  onChange={(e) => setDefaults({ flightCategory: e.target.value as typeof defaults.flightCategory })}
                  className="input"
                >
                  <option value="business">{t('settings:defaults.options.business')}</option>
                  <option value="private">{t('settings:defaults.options.private')}</option>
                  <option value="vacation">{t('settings:defaults.options.vacation')}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Map */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t('settings:map.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:map.description')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t('settings:map.mapStyle')}</label>
                <select
                  value={map.mapStyle}
                  onChange={(e) => setMap({ mapStyle: e.target.value as typeof map.mapStyle })}
                  className="input"
                >
                  <option value="osm">{t('settings:map.options.osm')}</option>
                  <option value="satellite">{t('settings:map.options.satellite')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('settings:map.zoomLevel')}</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={map.zoomLevel}
                  onChange={(e) => setMap({ zoomLevel: Number(e.target.value) })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">{t('settings:map.markerStyle')}</label>
                <select
                  value={map.markerStyle}
                  onChange={(e) => setMap({ markerStyle: e.target.value as typeof map.markerStyle })}
                  className="input"
                >
                  <option value="pin">{t('settings:map.options.pin')}</option>
                  <option value="circle">{t('settings:map.options.circle')}</option>
                  <option value="custom">{t('settings:map.options.custom')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('settings:map.routeColor')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={map.routeColor}
                    onChange={(e) => setMap({ routeColor: e.target.value })}
                    className="h-10 w-16 rounded"
                  />
                  <div className="flex gap-2">
                    {colorPresets.map((color) => (
                      <button
                        key={color}
                        onClick={() => setMap({ routeColor: color })}
                        style={{ backgroundColor: color }}
                        className="w-8 h-8 rounded-md border border-gray-200 dark:border-gray-700"
                        aria-label={`Farbe ${color}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t('settings:notifications.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:notifications.description')}</p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={notifications.emailNotifications}
                  onChange={(e) => setNotifications({ emailNotifications: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('settings:notifications.emailNotifications')}</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={notifications.checkInReminder}
                  onChange={(e) => setNotifications({ checkInReminder: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('settings:notifications.checkInReminder')}</span>
              </label>

              <div>
                <label className="label">{t('settings:notifications.flightReminder')}</label>
                <select
                  value={notifications.flightReminder}
                  onChange={(e) => setNotifications({ flightReminder: e.target.value as typeof notifications.flightReminder })}
                  className="input"
                >
                  <option value="off">{t('settings:notifications.options.off')}</option>
                  <option value="24h">{t('settings:notifications.options.24h')}</option>
                  <option value="48h">{t('settings:notifications.options.48h')}</option>
                </select>
              </div>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={notifications.featureUpdates}
                  onChange={(e) => setNotifications({ featureUpdates: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('settings:notifications.featureUpdates')}</span>
              </label>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Privacy */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t('settings:privacy.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:privacy.description')}</p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={privacy.twoFactorAuth}
                  onChange={(e) => setPrivacy({ twoFactorAuth: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('settings:privacy.twoFactorAuth')}</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={privacy.loginAlerts}
                  onChange={(e) => setPrivacy({ loginAlerts: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('settings:privacy.loginAlerts')}</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={privacy.analyticsOptIn}
                  onChange={(e) => setPrivacy({ analyticsOptIn: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('settings:privacy.analyticsOptIn')}</span>
              </label>

              <div className="flex items-center gap-3">
                <button
                  className="btn-secondary"
                  onClick={() => setPrivacy({ dataExportRequested: true })}
                >
                  {t('settings:privacy.dataExport')}
                </button>
                {privacy.dataExportRequested && <span className="text-sm text-green-500">{t('settings:privacy.dataExportRequested')}</span>}
              </div>
            </div>
          </div>

          {/* Backup */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t('settings:backup.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:backup.description')}</p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={backup.autoBackup}
                  onChange={(e) => setBackup({ autoBackup: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('settings:backup.autoBackup')}</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('settings:backup.backupInterval')}</label>
                  <select
                    value={backup.backupInterval}
                    onChange={(e) => setBackup({ backupInterval: e.target.value as typeof backup.backupInterval })}
                    className="input"
                  >
                    <option value="daily">{t('settings:backup.intervals.daily')}</option>
                    <option value="weekly">{t('settings:backup.intervals.weekly')}</option>
                    <option value="monthly">{t('settings:backup.intervals.monthly')}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('settings:backup.exportFormat')}</label>
                  <select
                    value={backup.exportFormat}
                    onChange={(e) => setBackup({ exportFormat: e.target.value as typeof backup.exportFormat })}
                    className="input"
                  >
                    <option value="json">{t('settings:backup.formats.json')}</option>
                    <option value="csv">{t('settings:backup.formats.csv')}</option>
                    <option value="pdf">{t('settings:backup.formats.pdf')}</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={backup.cloudSync}
                  onChange={(e) => setBackup({ cloudSync: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('settings:backup.cloudSync')}</span>
              </label>

              <div>
                <label className="label">{t('settings:backup.retentionDays')}</label>
                <input
                  type="number"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(parseInt(e.target.value, 10) || 30)}
                  min="1"
                  max="365"
                  className="input"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('settings:backup.retentionDaysDescription', { days: retentionDays })}
                </p>
              </div>

              {user?.isAdmin && (
                <>
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('settings:backup.status.title')}</p>
                    {backupStatus?.running ? (
                      <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                        <span className="animate-pulse">●</span>
                        <span>{t('settings:backup.status.running')}</span>
                      </div>
                    ) : lastBackup ? (
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {t('settings:backup.status.lastBackup', { date: new Date(lastBackup.completedAt).toLocaleString('de-DE') })}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                          {t('settings:backup.status.size', { size: (parseInt(lastBackup.size, 10) / 1024 / 1024).toFixed(2) })}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:backup.status.noBackup')}</p>
                    )}
                  </div>

                  <div className="pt-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t('settings:backup.status.path', { path: '/app/data/backups' })}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Auto-Update Settings */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{t('settings:autoUpdate.title')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:autoUpdate.description')}</p>
            </div>
            <Link
              to="/pending-updates"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium"
            >
              {t('settings:autoUpdate.viewPending')} →
            </Link>
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={autoUpdateSettings.enabled}
                onChange={(e) => {
                  const newSettings = { ...autoUpdateSettings, enabled: e.target.checked };
                  setAutoUpdateSettings(newSettings);
                  // Update settings immediately
                  settingsApi.update({ autoUpdate: newSettings }).catch((error) => {
                    logger.error('Failed to save auto-update settings:', error);
                  });
                }}
                className="h-4 w-4"
              />
              <span>{t('settings:autoUpdate.enabled') || 'Automatische Updates aktivieren'}</span>
            </label>

            {autoUpdateSettings.enabled && (
              <>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={autoUpdateSettings.requireApproval}
                    onChange={(e) => {
                      const newSettings = { ...autoUpdateSettings, requireApproval: e.target.checked };
                      setAutoUpdateSettings(newSettings);
                      settingsApi.update({ autoUpdate: newSettings }).catch((error) => {
                        logger.error('Failed to save auto-update settings:', error);
                      });
                    }}
                    className="h-4 w-4"
                  />
                  <span>{t('settings:autoUpdate.requireApproval') || 'Bestätigung erforderlich'}</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('settings:autoUpdate.checkInterval')}</label>
                    <input
                      type="number"
                      value={autoUpdateSettings.checkInterval}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        if (value >= 5 && value <= 1440) {
                          const newSettings = { ...autoUpdateSettings, checkInterval: value };
                          setAutoUpdateSettings(newSettings);
                          settingsApi.update({ autoUpdate: newSettings }).catch((error) => {
                            logger.error('Failed to save auto-update settings:', error);
                          });
                        }
                      }}
                      min="5"
                      max="1440"
                      className="input"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('settings:autoUpdate.checkIntervalDescription')}
                    </p>
                  </div>

                  <div>
                    <label className="label">{t('settings:autoUpdate.expiryHours')}</label>
                    <input
                      type="number"
                      value={autoUpdateSettings.expiryHours}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        if (value >= 1 && value <= 168) {
                          const newSettings = { ...autoUpdateSettings, expiryHours: value };
                          setAutoUpdateSettings(newSettings);
                          settingsApi.update({ autoUpdate: newSettings }).catch((error) => {
                            logger.error('Failed to save auto-update settings:', error);
                          });
                        }
                      }}
                      min="1"
                      max="168"
                      className="input"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('settings:autoUpdate.expiryHoursDescription')}
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={autoUpdateSettings.onlyDuringFlight}
                    onChange={(e) => {
                      const newSettings = { ...autoUpdateSettings, onlyDuringFlight: e.target.checked };
                      setAutoUpdateSettings(newSettings);
                      settingsApi.update({ autoUpdate: newSettings }).catch((error) => {
                        logger.error('Failed to save auto-update settings:', error);
                      });
                    }}
                    className="h-4 w-4"
                  />
                  <span>{t('settings:autoUpdate.onlyDuringFlight') || 'Nur während Flugzeit'}</span>
                </label>
              </>
            )}
          </div>
        </div>

        {/* Parser Configuration */}
        <ParserConfiguration />

        {/* API Keys */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{t('settings:apiKeys.title')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:apiKeys.description')}</p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Parser APIs */}
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                {t('settings:apiKeys.parserApis')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ApiKeyCard
                  provider="openai"
                  label={t('settings:apiKeys.openai.label')}
                  description={t('settings:apiKeys.openai.description')}
                  getKeyUrl="https://platform.openai.com/api-keys"
                  isShared={apiKeysStatus?.openai.isShared || false}
                  hasAccess={apiKeysStatus?.openai.hasAccess || false}
                  value={apiKeys.openaiApiKey}
                  onChange={(value) => setApiKeys({ ...apiKeys, openaiApiKey: value })}
                  onClear={() => setApiKeys({ ...apiKeys, openaiApiKey: '' })}
                />
                <ApiKeyCard
                  provider="claude"
                  label={t('settings:apiKeys.claude.label')}
                  description={t('settings:apiKeys.claude.description')}
                  getKeyUrl="https://console.anthropic.com/settings/keys"
                  isShared={apiKeysStatus?.claude.isShared || false}
                  hasAccess={apiKeysStatus?.claude.hasAccess || false}
                  value={apiKeys.claudeApiKey}
                  onChange={(value) => setApiKeys({ ...apiKeys, claudeApiKey: value })}
                  onClear={() => setApiKeys({ ...apiKeys, claudeApiKey: '' })}
                />
              </div>
            </div>

            {/* Flight Lookup APIs */}
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                {t('settings:apiKeys.flightApis')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ApiKeyCard
                  provider="airlabs"
                  label={t('settings:apiKeys.airlabs.label')}
                  description={t('settings:apiKeys.airlabs.description')}
                  getKeyUrl="https://airlabs.co/account"
                  isShared={apiKeysStatus?.airlabs.isShared || false}
                  hasAccess={apiKeysStatus?.airlabs.hasAccess || false}
                  value={apiKeys.airlabsApiKey}
                  onChange={(value) => setApiKeys({ ...apiKeys, airlabsApiKey: value })}
                  onClear={() => setApiKeys({ ...apiKeys, airlabsApiKey: '' })}
                />
                <ApiKeyCard
                  provider="aviationstack"
                  label={t('settings:apiKeys.aviationstack.label')}
                  description={t('settings:apiKeys.aviationstack.description')}
                  getKeyUrl="https://aviationstack.com/signup"
                  isShared={apiKeysStatus?.aviationstack.isShared || false}
                  hasAccess={apiKeysStatus?.aviationstack.hasAccess || false}
                  value={apiKeys.aviationstackApiKey}
                  onChange={(value) => setApiKeys({ ...apiKeys, aviationstackApiKey: value })}
                  onClear={() => setApiKeys({ ...apiKeys, aviationstackApiKey: '' })}
                />
                <ApiKeyCard
                  provider="opensky"
                  label={t('settings:apiKeys.opensky.label')}
                  description={t('settings:apiKeys.opensky.description')}
                  getKeyUrl="https://opensky-network.org/accounts/register"
                  isShared={apiKeysStatus?.opensky.isShared || false}
                  hasAccess={apiKeysStatus?.opensky.hasAccess || false}
                  openskyFields={{
                    clientId: apiKeys.openskyClientId,
                    clientSecret: apiKeys.openskyClientSecret,
                    onClientIdChange: (value) => setApiKeys({ ...apiKeys, openskyClientId: value }),
                    onClientSecretChange: (value) => setApiKeys({ ...apiKeys, openskyClientSecret: value }),
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={async () => {
                setLoadingApiKeys(true);
                try {
                  await settingsApi.updateApiKeys(apiKeys);
                  addToast('success', t('settings:apiKeys.saved') || 'API keys saved successfully');
                  // Reload status
                  const status = await settingsApi.getApiKeys();
                  setApiKeysStatus(status);
                  // Clear local values after save
                  setApiKeys({
                    openaiApiKey: '',
                    claudeApiKey: '',
                    airlabsApiKey: '',
                    aviationstackApiKey: '',
                    openskyClientId: '',
                    openskyClientSecret: '',
                  });
                } catch (error: any) {
                  logger.error('Failed to save API keys:', error);
                  addToast('error', error.response?.data?.error || t('settings:apiKeys.saveFailed') || 'Failed to save API keys');
                } finally {
                  setLoadingApiKeys(false);
                }
              }}
              disabled={loadingApiKeys}
              className="btn-primary"
            >
              {loadingApiKeys ? t('settings:apiKeys.saving') || 'Saving...' : t('settings:apiKeys.save') || 'Save API Keys'}
            </button>
          </div>
        </div>

        {/* Training Settings */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <span>🤖</span> {t('settings:training.title')}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t('settings:training.description')}
          </p>

          <InlineHelp
            title={t('settings:training.help.title')}
            category="expert"
            content={
              <div className="space-y-3">
                <p>
                  {t('settings:training.help.description')}
                </p>
                <div>
                  <p className="font-semibold mb-1">{t('settings:training.help.optionsTitle')}</p>
                  <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                    <li><strong>{t('settings:training.useTrainedModels')}:</strong> {t('settings:training.help.options.useTrainedModels')}</li>
                    <li><strong>{t('settings:training.preferredEmailModel')}:</strong> {t('settings:training.help.options.preferredEmailModel')}</li>
                    <li><strong>{t('settings:training.preferredVisionModel')}:</strong> {t('settings:training.help.options.preferredVisionModel')}</li>
                    <li><strong>{t('settings:training.trainingSeparateModels')}:</strong> {t('settings:training.help.options.trainingSeparateModels')}</li>
                  </ul>
                </div>
              </div>
            }
          />

          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  {t('settings:training.useTrainedModels')}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('settings:training.useTrainedModelsDescription')}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={trainingSettings.useTrainedModels}
                  onChange={(e) => setTrainingSettings({ ...trainingSettings, useTrainedModels: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <label className="label">{t('settings:training.preferredEmailModel')}</label>
              <select
                value={trainingSettings.preferredEmailModel}
                onChange={(e) => setTrainingSettings({ ...trainingSettings, preferredEmailModel: e.target.value as 'auto' | 'trained' | 'base' })}
                className="input"
              >
                <option value="auto">{t('settings:training.modelOptions.auto')}</option>
                <option value="trained">{t('settings:training.modelOptions.trained')}</option>
                <option value="base">{t('settings:training.modelOptions.base')}</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('settings:training.preferredEmailModelDescription')}
              </p>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <label className="label">{t('settings:training.preferredVisionModel')}</label>
              <select
                value={trainingSettings.preferredVisionModel}
                onChange={(e) => setTrainingSettings({ ...trainingSettings, preferredVisionModel: e.target.value as 'auto' | 'trained' | 'base' })}
                className="input"
              >
                <option value="auto">{t('settings:training.modelOptions.auto')}</option>
                <option value="trained">{t('settings:training.modelOptions.trained')}</option>
                <option value="base">{t('settings:training.modelOptions.base')}</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('settings:training.preferredVisionModelDescription')}
              </p>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  {t('settings:training.trainingSeparateModels')}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('settings:training.trainingSeparateModelsDescription')}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={trainingSettings.trainingSeparateModels}
                  onChange={(e) => setTrainingSettings({ ...trainingSettings, trainingSeparateModels: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleTrainingSettingsUpdate}
                disabled={loadingTrainingSettings}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingTrainingSettings ? t('settings:training.savingSettings') : t('settings:training.saveSettings')}
              </button>
            </div>
          </div>
        </div>

        {/* Developer Options - Only visible for users with training access */}
        {hasTrainingAccess && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <span>⚙️</span> {t('settings:developer.title')}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {t('settings:developer.description')}
            </p>

            <InlineHelp
              title={t('settings:developer.help.title')}
              category="expert"
              content={
                <div className="space-y-3">
                  <p>
                    {t('settings:developer.help.description')}
                  </p>
                  <div>
                    <p className="font-semibold mb-1">{t('settings:developer.help.features.title')}</p>
                    <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                      <li>{t('settings:developer.help.features.items.trainingPage')}</li>
                      <li>{t('settings:developer.help.features.items.uploadAnnotation')}</li>
                      <li>{t('settings:developer.help.features.items.loraTraining')}</li>
                      <li>{t('settings:developer.help.features.items.parserAccuracy')}</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold mb-1">{t('settings:developer.help.requirements.title')}</p>
                    <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                      <li>{t('settings:developer.help.requirements.items.ollama')}</li>
                      <li>{t('settings:developer.help.requirements.items.hardware')}</li>
                      <li>{t('settings:developer.help.requirements.items.trainingData')}</li>
                    </ul>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <strong>{t('settings:developer.help.noteLabel')}:</strong> {t('settings:developer.help.note')}
                  </p>
                </div>
              }
            />

            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                    {t('settings:developer.modeTitle')}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('settings:developer.modeDescription')}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={developerModeEnabled}
                    onChange={handleDeveloperModeToggle}
                    disabled={loadingDeveloperMode}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>

            {/* Confirmation Dialog */}
            {showDeveloperConfirm && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                    {t('settings:developer.confirmTitle')}
                  </h3>
                  <div className="space-y-3 mb-6">
                    <p className="text-gray-700 dark:text-gray-300">
                      {t('settings:developer.confirmMessage')}
                    </p>
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                      <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                        {t('settings:developer.risks.title')}
                      </p>
                      <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1 list-disc list-inside">
                        <li>{t('settings:developer.risks.items.resourceUsage')}</li>
                        <li>{t('settings:developer.risks.items.technicalKnowledge')}</li>
                        <li>{t('settings:developer.risks.items.unexpectedResults')}</li>
                        <li>{t('settings:developer.risks.items.longTraining')}</li>
                      </ul>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowDeveloperConfirm(false)}
                      className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      {t('settings:developer.cancel')}
                    </button>
                    <button
                      onClick={() => handleDeveloperModeConfirm(true)}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                    >
                      {t('settings:developer.activate')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Password Change Modal */}
        {showPasswordModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                {t('settings:password.title')}
              </h3>
              <div className="space-y-4">
                {passwordError && (
                  <div className="bg-red-100 dark:bg-red-900/20 border border-red-400 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded">
                    {passwordError}
                  </div>
                )}
                <div>
                  <label className="label">{t('settings:password.oldPassword')}</label>
                  <input
                    type="password"
                    value={passwordForm.oldPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                    className="input"
                    placeholder={t('settings:password.oldPassword')}
                    disabled={changingPassword}
                  />
                </div>
                <div>
                  <label className="label">{t('settings:password.newPassword')}</label>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    className="input"
                    placeholder={t('settings:password.newPassword')}
                    disabled={changingPassword}
                  />
                </div>
                <div>
                  <label className="label">{t('settings:password.confirmPassword')}</label>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                    className="input"
                    placeholder={t('settings:password.confirmPassword')}
                    disabled={changingPassword}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordError('');
                    setPasswordForm({
                      oldPassword: '',
                      newPassword: '',
                      confirmPassword: '',
                    });
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                  disabled={changingPassword}
                >
                  {t('common:buttons.cancel')}
                </button>
                <button
                  onClick={handlePasswordChange}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={changingPassword}
                >
                  {changingPassword ? t('settings:password.changing') : t('settings:password.submit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Admin Panel Link - Only visible for admins */}
        {user?.isAdmin && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <span>👑</span> {t('settings:admin.title')}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {t('settings:admin.description')}
            </p>
            <Link
              to="/admin"
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {t('settings:admin.openAdminPanel')}
            </Link>
          </div>
        )}

        {/* About & License */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <span>ℹ️</span> About TravStats
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            TravStats - Flight Statistics Tracking Application
          </p>
          <div className="space-y-3">
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                <strong>License:</strong> GNU Affero General Public License v3.0 (AGPL-3.0)
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                Copyright © 2025 Dennis Wittke
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License.
                If you run this software as a web service, you must make the complete source code available under AGPL-3.0.
              </p>
              <a
                href="https://github.com/Abrechen2/TravStats"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 bg-gray-800 dark:bg-gray-700 hover:bg-gray-900 dark:hover:bg-gray-600 text-white font-medium rounded-lg transition-colors text-sm"
              >
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
                View Source Code on GitHub
              </a>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700 rounded-lg p-4 text-sm text-blue-900 dark:text-blue-100 flex items-center justify-between">
          <div>
            <p className="font-semibold">{t('settings:autoSaved.title')}</p>
            <p className="text-blue-800 dark:text-blue-200">{t('settings:autoSaved.description')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              {t('settings:scrollToTop')}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

