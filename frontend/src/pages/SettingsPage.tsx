import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import DarkModeToggle from '../components/DarkModeToggle';
import InlineHelp from '../components/Help/InlineHelp';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import ParserConfiguration from '../components/Settings/ParserConfiguration';
import { settingsApi, authApi, backupApi } from '../lib/api';
import { useToastStore } from '../store/toastStore';
import { logger } from '../lib/logger';

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

  // Check if user has training access (admin or canTrainLLM)
  const hasTrainingAccess = user?.isAdmin || (user as any)?.canTrainLLM || false;

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

  const handleTrainingSettingsUpdate = async () => {
    setLoadingTrainingSettings(true);
    try {
      await settingsApi.updateTrainingSettings(trainingSettings);
      addToast('success', 'Training-Einstellungen erfolgreich aktualisiert');
    } catch (error) {
      logger.error('Failed to update training settings:', error);
      addToast('error', 'Fehler beim Aktualisieren der Training-Einstellungen');
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
      addToast('error', 'Bitte wählen Sie eine Bilddatei aus');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      addToast('error', 'Bilddatei ist zu groß (max. 5MB)');
      return;
    }

    setUploadingProfilePicture(true);
    try {
      const result = await settingsApi.uploadProfilePicture(file);
      setProfile({ profilePicture: result.profilePictureUrl });
      addToast('success', 'Profilbild erfolgreich hochgeladen');
    } catch (error: any) {
      logger.error('Failed to upload profile picture:', error);
      addToast('error', error.response?.data?.error || 'Fehler beim Hochladen des Profilbilds');
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
      alert('Fehler beim Aktualisieren des Developer Mode');
    } finally {
      setLoadingDeveloperMode(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError('');

    // Validation
    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError('Bitte füllen Sie alle Felder aus');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordError('Das neue Passwort muss mindestens 6 Zeichen lang sein');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Die neuen Passwörter stimmen nicht überein');
      return;
    }

    if (passwordForm.oldPassword === passwordForm.newPassword) {
      setPasswordError('Das neue Passwort muss sich vom alten unterscheiden');
      return;
    }

    setChangingPassword(true);

    try {
      await authApi.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      addToast('success', 'Passwort erfolgreich geändert');
      setShowPasswordModal(false);
      setPasswordForm({
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error: any) {
      logger.error('Failed to change password:', error);
      setPasswordError(error.response?.data?.error || 'Fehler beim Ändern des Passworts. Bitte überprüfen Sie Ihr aktuelles Passwort.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Roadmap · Punkt 9</p>
            <h1 className="text-3xl font-bold">Einstellungen</h1>
            <p className="text-gray-500 dark:text-gray-400">Profile, Präferenzen und Sicherheit an einem Ort.</p>
          </div>
          <div className="flex items-center gap-3">
            <DarkModeToggle />
            <Link to="/" className="btn-secondary">
              ← Zurück zum Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile */}
          <div className="card lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Benutzer-Profil</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Passe Benutzername, Kontaktinformationen und dein Profilbild an.
                </p>
              </div>
              <button
                onClick={() => setShowPasswordModal(true)}
                className="btn-secondary"
              >
                Passwort ändern
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl font-bold text-white">
                {profile.profilePicture ? (
                  <img
                    src={profile.profilePicture}
                    alt="Profil"
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  profile.username.charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <label className="label">Profilbild hochladen</label>
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
                <label className="label">Benutzername</label>
                <input
                  type="text"
                  value={profile.username}
                  onChange={(e) => setProfile({ username: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">E-Mail-Adresse</label>
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
                Account löschen
              </button>
              {privacy.accountDeletionRequested && (
                <span className="text-sm text-red-500">Löschanfrage vorgemerkt</span>
              )}
            </div>
          </div>

          {/* Display & Locale */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Anzeige & Sprache</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Modus, Sprache und Zeitzone zentral steuern.</p>
              </div>
              <button
                onClick={handleThemeToggle}
                className={`px-3 py-2 rounded-lg border text-sm ${
                  isDarkMode
                    ? 'bg-gray-800 text-yellow-400 border-gray-700'
                    : 'bg-gray-100 text-gray-800 border-gray-200'
                }`}
              >
                {display.theme === 'dark' ? 'Dark Mode aktiv' : 'Light Mode aktiv'}
              </button>
            </div>

            <InlineHelp
              title="Theme-Einstellungen"
              category="basic"
              content={
                <div className="space-y-2">
                  <p>
                    Das Theme bestimmt das Farbschema der Anwendung. Dark Mode ist bei schlechten Lichtverhältnissen angenehmer für die Augen.
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                    <li>
                      <strong>Light Mode:</strong> Helles Farbschema, ideal bei Tageslicht
                    </li>
                    <li>
                      <strong>Dark Mode:</strong> Dunkles Farbschema, reduziert Augenbelastung bei wenig Licht
                    </li>
                    <li>
                      Die Einstellung wird automatisch gespeichert und bleibt bei zukünftigen Besuchen erhalten
                    </li>
                  </ul>
                </div>
              }
            />

            <div>
              <label className="label">Sprache</label>
              <select
                value={display.language}
                onChange={(e) => setDisplay({ language: e.target.value as 'de' | 'en' })}
                className="input"
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </div>

            <div>
              <label className="label">Zeitzone</label>
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
                <label className="label">Datumsformat</label>
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
                <label className="label">Zeitformat</label>
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
                <h2 className="text-xl font-semibold">Einheiten & Formate</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Definiere die Standard-Einheiten für Statistiken.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Distanz</label>
                <select
                  value={units.distanceUnit}
                  onChange={(e) => setUnits({ distanceUnit: e.target.value as typeof units.distanceUnit })}
                  className="input"
                >
                  <option value="kilometers">Kilometer</option>
                  <option value="miles">Meilen</option>
                  <option value="nautical_miles">Nautische Meilen</option>
                </select>
              </div>
              <div>
                <label className="label">Währung</label>
                <select
                  value={units.currency}
                  onChange={(e) => setUnits({ currency: e.target.value as typeof units.currency })}
                  className="input"
                >
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="CHF">CHF (Fr)</option>
                </select>
              </div>
              <div>
                <label className="label">Temperatur</label>
                <select
                  value={units.temperature}
                  onChange={(e) => setUnits({ temperature: e.target.value as typeof units.temperature })}
                  className="input"
                >
                  <option value="celsius">Celsius</option>
                  <option value="fahrenheit">Fahrenheit</option>
                </select>
              </div>
            </div>
          </div>

          {/* Defaults */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Standard-Werte</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Neue Flüge werden mit diesen Vorgaben angelegt.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Status</label>
                <select
                  value={defaults.flightStatus}
                  onChange={(e) => setDefaults({ flightStatus: e.target.value as typeof defaults.flightStatus })}
                  className="input"
                >
                  <option value="scheduled">Geplant</option>
                  <option value="flown">Geflogen</option>
                </select>
              </div>
              <div>
                <label className="label">Sitzklasse</label>
                <select
                  value={defaults.seatClass}
                  onChange={(e) => setDefaults({ seatClass: e.target.value as typeof defaults.seatClass })}
                  className="input"
                >
                  <option value="economy">Economy</option>
                  <option value="premium_economy">Premium Economy</option>
                  <option value="business">Business</option>
                  <option value="first">First</option>
                </select>
              </div>
              <div>
                <label className="label">Lieblings-Airline</label>
                <input
                  type="text"
                  value={defaults.favoriteAirline}
                  onChange={(e) => setDefaults({ favoriteAirline: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Flugkategorie</label>
                <select
                  value={defaults.flightCategory}
                  onChange={(e) => setDefaults({ flightCategory: e.target.value as typeof defaults.flightCategory })}
                  className="input"
                >
                  <option value="business">Geschäftlich</option>
                  <option value="private">Privat</option>
                  <option value="vacation">Urlaub</option>
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
                <h2 className="text-xl font-semibold">Karten-Einstellungen</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Steuere Basiskarte, Zoom und Marker.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Kartenansicht</label>
                <select
                  value={map.mapStyle}
                  onChange={(e) => setMap({ mapStyle: e.target.value as typeof map.mapStyle })}
                  className="input"
                >
                  <option value="osm">OpenStreetMap</option>
                  <option value="satellite">Satellite</option>
                </select>
              </div>
              <div>
                <label className="label">Start-Zoom</label>
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
                <label className="label">Marker-Stil</label>
                <select
                  value={map.markerStyle}
                  onChange={(e) => setMap({ markerStyle: e.target.value as typeof map.markerStyle })}
                  className="input"
                >
                  <option value="pin">Pin</option>
                  <option value="circle">Kreis</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="label">Routenfarbe</label>
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
                <h2 className="text-xl font-semibold">Benachrichtigungen</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Erinnerungen und Updates steuern.</p>
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
                <span>E-Mail-Benachrichtigungen aktivieren</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={notifications.checkInReminder}
                  onChange={(e) => setNotifications({ checkInReminder: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>Check-in Reminder</span>
              </label>

              <div>
                <label className="label">Flug-Erinnerung</label>
                <select
                  value={notifications.flightReminder}
                  onChange={(e) => setNotifications({ flightReminder: e.target.value as typeof notifications.flightReminder })}
                  className="input"
                >
                  <option value="off">Aus</option>
                  <option value="24h">24h vorher</option>
                  <option value="48h">48h vorher</option>
                </select>
              </div>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={notifications.featureUpdates}
                  onChange={(e) => setNotifications({ featureUpdates: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>Neue Feature-Updates</span>
              </label>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Privacy */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Datenschutz & Sicherheit</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Verwalte Login-Schutz und Datenanfragen.</p>
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
                <span>Zwei-Faktor-Authentifizierung aktivieren</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={privacy.loginAlerts}
                  onChange={(e) => setPrivacy({ loginAlerts: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>Login-Historie & Alarm-E-Mails</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={privacy.analyticsOptIn}
                  onChange={(e) => setPrivacy({ analyticsOptIn: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>Analytics Opt-in (anonymisiert)</span>
              </label>

              <div className="flex items-center gap-3">
                <button
                  className="btn-secondary"
                  onClick={() => setPrivacy({ dataExportRequested: true })}
                >
                  Daten-Export anfordern
                </button>
                {privacy.dataExportRequested && <span className="text-sm text-green-500">Anfrage vorgemerkt</span>}
              </div>
            </div>
          </div>

          {/* Backup */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Backup & Sync</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Regelmäßige Sicherungen und Cloud-Sync steuern.</p>
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
                <span>Automatische Backups aktivieren</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Backup-Intervall</label>
                  <select
                    value={backup.backupInterval}
                    onChange={(e) => setBackup({ backupInterval: e.target.value as typeof backup.backupInterval })}
                    className="input"
                  >
                    <option value="daily">Täglich</option>
                    <option value="weekly">Wöchentlich</option>
                    <option value="monthly">Monatlich</option>
                  </select>
                </div>
                <div>
                  <label className="label">Export-Format</label>
                  <select
                    value={backup.exportFormat}
                    onChange={(e) => setBackup({ exportFormat: e.target.value as typeof backup.exportFormat })}
                    className="input"
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                    <option value="pdf">PDF</option>
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
                <span>Cloud-Sync aktivieren</span>
              </label>

              <div>
                <label className="label">Aufbewahrungsdauer (Tage)</label>
                <input
                  type="number"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(parseInt(e.target.value, 10) || 30)}
                  min="1"
                  max="365"
                  className="input"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Backups älter als {retentionDays} Tage werden automatisch gelöscht
                </p>
              </div>

              {user?.isAdmin && (
                <>
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Backup-Status</p>
                    {backupStatus?.running ? (
                      <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                        <span className="animate-pulse">●</span>
                        <span>Backup läuft...</span>
                      </div>
                    ) : lastBackup ? (
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Letztes Backup: {new Date(lastBackup.completedAt).toLocaleString('de-DE')}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                          Größe: {(parseInt(lastBackup.size, 10) / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">Noch kein Backup erstellt</p>
                    )}
                  </div>

                  <div className="pt-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Backup-Pfad: /app/data/backups
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Parser Configuration */}
        <ParserConfiguration />

        {/* Training Settings */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <span>🤖</span> Training-Einstellungen
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Konfiguriere die Verwendung trainierter LLM-Modelle für bessere Parsing-Genauigkeit
          </p>

          <InlineHelp
            title="Training-Einstellungen"
            category="expert"
            content={
              <div className="space-y-3">
                <p>
                  Diese Einstellungen steuern, ob und wie trainierte LLM-Modelle verwendet werden.
                </p>
                <div>
                  <p className="font-semibold mb-1">Optionen:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                    <li><strong>Trainierte Modelle verwenden:</strong> Aktiviert automatische Verwendung trainierter Modelle wenn verfügbar</li>
                    <li><strong>Email-Modell-Präferenz:</strong> Wähle zwischen Auto (trainiert wenn verfügbar), Trained (nur trainiert) oder Base (nur Basis-Modell)</li>
                    <li><strong>Vision-Modell-Präferenz:</strong> Gleiche Optionen für Boarding-Pass-Parsing</li>
                    <li><strong>Separate Modelle:</strong> Verwendet getrennte Modelle für Email und Vision (empfohlen für bessere Spezialisierung)</li>
                  </ul>
                </div>
              </div>
            }
          />

          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  Trainierte Modelle verwenden
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Automatisch trainierte Modelle verwenden, wenn verfügbar
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
              <label className="label">Email-Modell-Präferenz</label>
              <select
                value={trainingSettings.preferredEmailModel}
                onChange={(e) => setTrainingSettings({ ...trainingSettings, preferredEmailModel: e.target.value as 'auto' | 'trained' | 'base' })}
                className="input"
              >
                <option value="auto">Auto (trainiert wenn verfügbar, sonst Base)</option>
                <option value="trained">Nur trainiertes Modell</option>
                <option value="base">Nur Basis-Modell</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Bestimmt welches Modell für Email-Parsing verwendet wird
              </p>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <label className="label">Vision-Modell-Präferenz</label>
              <select
                value={trainingSettings.preferredVisionModel}
                onChange={(e) => setTrainingSettings({ ...trainingSettings, preferredVisionModel: e.target.value as 'auto' | 'trained' | 'base' })}
                className="input"
              >
                <option value="auto">Auto (trainiert wenn verfügbar, sonst Base)</option>
                <option value="trained">Nur trainiertes Modell</option>
                <option value="base">Nur Basis-Modell</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Bestimmt welches Modell für Boarding-Pass-Parsing verwendet wird
              </p>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  Separate Modelle für Email/Vision
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Verwendet getrennte Modelle für bessere Spezialisierung (empfohlen)
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
                {loadingTrainingSettings ? 'Wird gespeichert...' : 'Einstellungen speichern'}
              </button>
            </div>
          </div>
        </div>

        {/* Developer Options - Only visible for users with training access */}
        {hasTrainingAccess && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <span>⚙️</span> Developer Options
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Experimentelle Funktionen für LLM-Training und erweiterte Features
            </p>

            <InlineHelp
              title="Developer Mode"
              category="expert"
              content={
                <div className="space-y-3">
                  <p>
                    Der Developer Mode aktiviert erweiterte Funktionen für das Training von LLM-Modellen.
                  </p>
                  <div>
                    <p className="font-semibold mb-1">Funktionen:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                      <li>Zugriff auf die Training-Page zum Trainieren von Ollama-Modellen</li>
                      <li>Upload und Annotation von Trainingsdaten (E-Mails, Boarding Passes)</li>
                      <li>LoRA-Training mit eigenen Daten</li>
                      <li>Verbesserung der Parser-Genauigkeit durch Training</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Voraussetzungen:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                      <li>Ollama muss installiert und erreichbar sein</li>
                      <li>Ausreichend Hardware-Ressourcen (CPU/GPU, RAM)</li>
                      <li>Mindestens 5 annotierte Trainingsdaten</li>
                    </ul>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <strong>Hinweis:</strong> Diese Funktion ist experimentell und kann Systemressourcen stark belasten.
                  </p>
                </div>
              }
            />

            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                    LLM Training Mode
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Aktiviert die Möglichkeit, lokale Ollama LLMs zu trainieren
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
                    ⚠️ Developer Mode aktivieren?
                  </h3>
                  <div className="space-y-3 mb-6">
                    <p className="text-gray-700 dark:text-gray-300">
                      Diese Funktion ist <strong>experimentell</strong> und sollte nur von erfahrenen Benutzern verwendet werden.
                    </p>
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                      <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                        Risiken und Hinweise:
                      </p>
                      <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1 list-disc list-inside">
                        <li>Kann Systemressourcen stark belasten</li>
                        <li>Erfordert technisches Verständnis</li>
                        <li>Kann zu unerwarteten Ergebnissen führen</li>
                        <li>Training kann lange dauern</li>
                      </ul>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowDeveloperConfirm(false)}
                      className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={() => handleDeveloperModeConfirm(true)}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                    >
                      Aktivieren
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
                Passwort ändern
              </h3>
              <div className="space-y-4">
                {passwordError && (
                  <div className="bg-red-100 dark:bg-red-900/20 border border-red-400 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded">
                    {passwordError}
                  </div>
                )}
                <div>
                  <label className="label">Aktuelles Passwort</label>
                  <input
                    type="password"
                    value={passwordForm.oldPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                    className="input"
                    placeholder="Aktuelles Passwort eingeben"
                    disabled={changingPassword}
                  />
                </div>
                <div>
                  <label className="label">Neues Passwort</label>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    className="input"
                    placeholder="Mindestens 6 Zeichen"
                    disabled={changingPassword}
                  />
                </div>
                <div>
                  <label className="label">Neues Passwort bestätigen</label>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                    className="input"
                    placeholder="Passwort wiederholen"
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
                  Abbrechen
                </button>
                <button
                  onClick={handlePasswordChange}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={changingPassword}
                >
                  {changingPassword ? 'Wird geändert...' : 'Passwort ändern'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Admin Panel Link - Only visible for admins */}
        {user?.isAdmin && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <span>👑</span> Administration
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Manage users, invitations, and system settings
            </p>
            <Link
              to="/admin"
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Open Admin Panel
            </Link>
          </div>
        )}

        <div className="bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700 rounded-lg p-4 text-sm text-blue-900 dark:text-blue-100 flex items-center justify-between">
          <div>
            <p className="font-semibold">Automatisch gespeichert</p>
            <p className="text-blue-800 dark:text-blue-200">Alle Einstellungen werden lokal gespeichert und sind sofort aktiv.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              Nach oben
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

