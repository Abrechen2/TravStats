import { Link } from 'react-router-dom';
import DarkModeToggle from '../components/DarkModeToggle';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';

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
    emailImport,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    setNotifications,
    setPrivacy,
    setBackup,
    setEmailImport,
  } = useSettingsStore();

  const { isDarkMode, setDarkMode } = useThemeStore();

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setProfile({ profilePicture: url });
  };

  const handleThemeToggle = () => {
    const nextIsDark = !isDarkMode;
    setDarkMode(nextIsDark);
    setDisplay({ theme: nextIsDark ? 'dark' : 'light' });
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
                onClick={() => alert('Passwort-Änderung wird bald unterstützt.')}
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
            </div>
          </div>
        </div>

        {/* Email Import */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold">E-Mail Parser & Weiterleitung</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Aktiviere die automatische Erkennung von Bordkarten-E-Mails, sobald dein Admin die Funktion global freigeschaltet hat.
              </p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${emailImport.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
              {emailImport.enabled ? 'Import aktiv' : 'Import aus'}
            </span>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={emailImport.enabled}
                onChange={(e) => setEmailImport({ enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <div>
                <div className="font-semibold">E-Mail Parser nutzen</div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Nutze deine Weiterleitung oder das Secret deines Admins, um Buchungsbestätigungen automatisch vorzubereiten.
                </p>
              </div>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Deine Weiterleitungsadresse</label>
                <input
                  type="email"
                  value={emailImport.forwardingAddress || ''}
                  onChange={(e) => setEmailImport({ forwardingAddress: e.target.value || null })}
                  className="input"
                  placeholder="z.B. boarding@example.com"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Diese Adresse wird nur gespeichert, damit du sie im Blick behältst. Der Admin hinterlegt die Ziel-Mailbox.
                </p>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={emailImport.autoAccept}
                    onChange={(e) => setEmailImport({ autoAccept: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span>Importe automatisch annehmen</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={emailImport.shareWithAdmin}
                    onChange={(e) => setEmailImport({ shareWithAdmin: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span>Fehlerhafte Parsergebnisse mit Admin teilen</span>
                </label>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 space-y-1">
              <p className="font-semibold">Hinweis für Nutzer</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Bitte frage deinen Admin nach dem Import-Secret oder der Weiterleitungsadresse.</li>
                <li>Nur aktivieren, wenn der Admin die Funktion freigeschaltet hat, sonst bleiben Mails unbeachtet.</li>
                <li>Du kannst das Secret jederzeit ändern, sobald es vom Admin aktualisiert wird.</li>
              </ul>
            </div>
          </div>
        </div>

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

