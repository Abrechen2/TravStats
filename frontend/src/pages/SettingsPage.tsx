import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import NavigationBar from "../components/NavigationBar";
import InlineHelp from "../components/Help/InlineHelp";
import { useSettingsStore } from "../store/settingsStore";
import { useThemeStore } from "../store/themeStore";
import { useAuthStore } from "../store/authStore";
import ParserConfiguration from "../components/Settings/ParserConfiguration";
import ApiKeyCard from "../components/Settings/ApiKeyCard";
import { settingsApi, authApi, backupApi } from "../lib/api";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";
import { changeLanguage } from "../i18n/config";
import PageTransition from "../components/PageTransition";

const timezoneOptions = [
  "Europe/Berlin",
  "Europe/Paris",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
];

const colorPresets = ["#2563eb", "#16a34a", "#f97316", "#7c3aed", "#e11d48"];

export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
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
    boardingPassParserStrategy,
    setBoardingPassParserStrategy,
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
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState("");
  const [lastBackup, setLastBackup] = useState<{
    completedAt: string | null;
    size: string;
    status: string;
  } | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ running: boolean } | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [trainingSettings, setTrainingSettings] = useState({
    useTrainedModels: true,
    preferredEmailModel: "auto" as "auto" | "trained" | "base",
    preferredVisionModel: "auto" as "auto" | "trained" | "base",
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
  const [historicalEnrichmentSettings, setHistoricalEnrichmentSettings] = useState({
    enabled: false,
    minConfidence: 60,
    maxAgeYears: 5,
    autoProcess: false,
    maxPerDay: 50,
    requireApproval: true,
  });
  const [loadingHistoricalEnrichmentSettings, setLoadingHistoricalEnrichmentSettings] =
    useState(false);
  const [apiKeysStatus, setApiKeysStatus] = useState<{
    openai: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    claude: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    airlabs: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    aviationstack: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  } | null>(null);
  const [apiKeys, setApiKeys] = useState({
    openaiApiKey: "",
    claudeApiKey: "",
    airlabsApiKey: "",
    aviationstackApiKey: "",
    openskyClientId: "",
    openskyClientSecret: "",
  });
  const [loadingApiKeys, setLoadingApiKeys] = useState(false);

  // Active sidebar section
  const [activeSection, setActiveSection] = useState<string>("profile");

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
        logger.error("Failed to load training settings:", error);
      }
    };
    loadTrainingSettings();
  }, []);

  // Load auto-update settings and boarding pass parser strategy
  useEffect(() => {
    const loadAutoUpdateSettings = async () => {
      try {
        const settings = await settingsApi.get();
        logger.info("Loaded settings from server:", settings);

        // Load auto-update settings (always set, even if not in response)
        logger.info("Setting auto-update settings:", settings.autoUpdate);
        setAutoUpdateSettings({
          enabled: settings.autoUpdate?.enabled ?? false,
          requireApproval: settings.autoUpdate?.requireApproval ?? true,
          checkInterval: settings.autoUpdate?.checkInterval ?? 15,
          onlyDuringFlight: settings.autoUpdate?.onlyDuringFlight ?? true,
          expiryHours: settings.autoUpdate?.expiryHours ?? 24,
        });

        // Load boarding pass parser strategy
        if (settings.boardingPassParserStrategy !== undefined) {
          setBoardingPassParserStrategy(settings.boardingPassParserStrategy);
        }

        // Load historical enrichment settings (always set, even if not in response)
        logger.info("Setting historical enrichment settings:", settings.historicalEnrichment);
        setHistoricalEnrichmentSettings({
          enabled: settings.historicalEnrichment?.enabled ?? false,
          minConfidence: settings.historicalEnrichment?.minConfidence ?? 60,
          maxAgeYears: settings.historicalEnrichment?.maxAgeYears ?? 5,
          autoProcess: settings.historicalEnrichment?.autoProcess ?? false,
          maxPerDay: settings.historicalEnrichment?.maxPerDay ?? 50,
          requireApproval: settings.historicalEnrichment?.requireApproval ?? true,
        });
      } catch (error) {
        logger.error("Failed to load auto-update settings:", error);
      }
    };
    loadAutoUpdateSettings();

    // Load API keys status
    const loadApiKeysStatus = async () => {
      try {
        const status = await settingsApi.getApiKeys();
        setApiKeysStatus(status);
      } catch (error) {
        logger.error("Failed to load API keys status:", error);
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
      // Reload settings from server to ensure we have the latest values
      const reloaded = await settingsApi.get();
      if (reloaded.autoUpdate) {
        setAutoUpdateSettings(reloaded.autoUpdate);
      }
      addToast(
        "success",
        t("settings:autoUpdate.saved") || "Auto-Update-Einstellungen gespeichert"
      );
    } catch (error) {
      logger.error("Failed to save auto-update settings:", error);
      addToast("error", t("settings:autoUpdate.saveFailed") || "Fehler beim Speichern");
    } finally {
      setLoadingAutoUpdateSettings(false);
    }
  };

  // Save historical enrichment settings
  const saveHistoricalEnrichmentSettings = async () => {
    try {
      setLoadingHistoricalEnrichmentSettings(true);
      logger.info("Saving historical enrichment settings:", historicalEnrichmentSettings);
      const payload = {
        historicalEnrichment: historicalEnrichmentSettings,
      };
      logger.info("Sending payload to server:", payload);
      await settingsApi.update(payload);
      // Reload settings from server to ensure we have the latest values
      const reloaded = await settingsApi.get();
      logger.info("Reloaded settings from server:", reloaded);
      if (reloaded.historicalEnrichment) {
        setHistoricalEnrichmentSettings(reloaded.historicalEnrichment);
      }
      addToast(
        "success",
        t("settings:historicalEnrichment.saved") ||
          "Historische Anreicherungs-Einstellungen gespeichert"
      );
    } catch (error) {
      logger.error("Failed to save historical enrichment settings:", error);
      addToast("error", t("settings:historicalEnrichment.saveFailed") || "Fehler beim Speichern");
    } finally {
      setLoadingHistoricalEnrichmentSettings(false);
    }
  };

  // Auto-save units settings when they change
  useEffect(() => {
    const saveSettings = async () => {
      try {
        await saveRemoteSettings();
      } catch (error) {
        logger.error("Failed to save units settings:", error);
        addToast("error", t("settings:errors.saveFailed") || "Failed to save settings");
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
      addToast("success", t("settings:training.updated"));
    } catch (error) {
      logger.error("Failed to update training settings:", error);
      addToast("error", t("settings:training.updateFailed"));
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

          const completedBackups = backupsData.backups.filter((b) => b.status === "completed");
          if (completedBackups.length > 0) {
            setLastBackup(completedBackups[0]);
          }
          setBackupStatus(statusData);
        } catch (error) {
          logger.error("Failed to load backup info:", error);
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
        .catch((error: unknown) => {
          // Handle 403 (forbidden) or 401 (unauthorized) errors gracefully
          const axiosError = error as { response?: { status?: number } };
          if (axiosError.response?.status === 403 || axiosError.response?.status === 401) {
            logger.warn("Training access denied or not available:", error);
            // Don't show error to user, just don't enable developer mode
            setDeveloperModeEnabled(false);
          } else {
            logger.error("Failed to load developer mode status:", error);
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
    if (!file.type.startsWith("image/")) {
      addToast("error", t("settings:profile.invalidFileType"));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      addToast("error", t("settings:profile.fileTooLarge"));
      return;
    }

    setUploadingProfilePicture(true);
    try {
      const result = await settingsApi.uploadProfilePicture(file);
      setProfile({ profilePicture: result.profilePictureUrl });
      addToast("success", t("settings:profile.uploadSuccess"));
    } catch (error: unknown) {
      logger.error("Failed to upload profile picture:", error);
      const axiosError = error as { response?: { data?: { error?: string } } };
      addToast("error", axiosError.response?.data?.error || t("settings:profile.uploadError"));
      // Fallback: show local preview
      const url = URL.createObjectURL(file);
      setProfile({ profilePicture: url });
    } finally {
      setUploadingProfilePicture(false);
      // Reset input
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleThemeToggle = () => {
    const nextIsDark = !isDarkMode;
    setDarkMode(nextIsDark);
    setDisplay({ theme: nextIsDark ? "dark" : "light" });
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
      logger.error("Failed to update developer mode:", error);
      alert(t("settings:developer.updateError"));
    } finally {
      setLoadingDeveloperMode(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError("");

    // Validation
    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError(t("common:messages.error"));
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordError(t("common:messages.error"));
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError(t("common:messages.error"));
      return;
    }

    if (passwordForm.oldPassword === passwordForm.newPassword) {
      setPasswordError(t("common:messages.error"));
      return;
    }

    setChangingPassword(true);

    try {
      await authApi.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      addToast("success", t("settings:password.success"));
      setShowPasswordModal(false);
      setPasswordForm({
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (error: unknown) {
      logger.error("Failed to change password:", error);
      const axiosError = error as { response?: { data?: { error?: string } } };
      setPasswordError(axiosError.response?.data?.error || t("settings:password.error"));
    } finally {
      setChangingPassword(false);
    }
  };

  const sections = [
    { id: "profile", label: t("settings:profile.title") || "Profile" },
    { id: "display", label: t("settings:display.title") || "Display" },
    { id: "units", label: t("settings:units.title") || "Units" },
    { id: "defaults", label: t("settings:defaults.title") || "Defaults" },
    { id: "map", label: t("settings:map.title") || "Map" },
    { id: "notifications", label: t("settings:notifications.title") || "Notifications" },
    { id: "privacy", label: t("settings:privacy.title") || "Privacy" },
    { id: "backup", label: t("settings:backup.title") || "Backup" },
    { id: "parser", label: "Parser" },
    { id: "autoupdate", label: t("settings:autoUpdate.title") || "Auto-Update" },
    { id: "enrichment", label: t("settings:historicalEnrichment.title") || "Enrichment" },
    { id: "apikeys", label: t("settings:apiKeys.title") || "API Keys" },
    { id: "training", label: t("settings:training.title") || "Training" },
    ...(hasTrainingAccess
      ? [{ id: "developer", label: t("settings:developer.title") || "Developer" }]
      : []),
    ...(user?.isAdmin ? [{ id: "admin", label: t("settings:admin.title") || "Admin" }] : []),
    { id: "about", label: "About" },
  ];

  const AmberToggle = ({
    checked,
    onChange,
    disabled = false,
  }: {
    checked: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="checkbox"
    />
  );

  const SectionCard = ({ children }: { children: React.ReactNode }) => (
    <div
      className="rounded-xl p-6 space-y-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {children}
    </div>
  );

  const SectionTitle = ({ title, description }: { title: string; description?: string }) => (
    <div>
      <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
      {description && (
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      )}
    </div>
  );

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="flex h-[calc(100vh-3.5rem)]">
          {/* Sidebar */}
          <aside
            className="w-52 flex-shrink-0 flex-col py-4 overflow-y-auto hidden md:flex"
            style={{
              background: "var(--bg-surface)",
              borderRight: "1px solid var(--color-border)",
            }}
          >
            <nav className="space-y-0.5 px-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: activeSection === section.id ? "var(--bg-elevated)" : "transparent",
                    color: activeSection === section.id ? "var(--accent)" : "var(--text-muted)",
                    borderLeft:
                      activeSection === section.id
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                  }}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Right content area */}
          <main className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Profile */}
            {activeSection === "profile" && (
              <SectionCard>
                <div className="flex items-center justify-between">
                  <SectionTitle
                    title={t("settings:profile.title")}
                    description={t("settings:profile.description")}
                  />
                  <button onClick={() => setShowPasswordModal(true)} className="btn-secondary">
                    {t("settings:profile.changePassword")}
                  </button>
                </div>

                <div className="flex items-center gap-4">
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white"
                    style={{ background: "linear-gradient(135deg, var(--accent), #c27a1a)" }}
                  >
                    {profile.profilePicture ? (
                      <img
                        src={profile.profilePicture}
                        alt={t("settings:profile.title")}
                        className="w-full h-full object-cover rounded-full"
                      />
                    ) : (
                      profile.username.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <label className="label">{t("settings:profile.uploadAvatar")}</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      disabled={uploadingProfilePicture}
                      className="text-sm"
                      style={{ color: "var(--text-muted)" }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t("settings:profile.username")}</label>
                    <input
                      type="text"
                      value={profile.username}
                      onChange={(e) => setProfile({ username: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">{t("settings:profile.email")}</label>
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
                    {t("settings:profile.deleteAccount")}
                  </button>
                  {privacy.accountDeletionRequested && (
                    <span className="text-sm" style={{ color: "var(--danger)" }}>
                      {t("settings:profile.deletionRequested")}
                    </span>
                  )}
                </div>
              </SectionCard>
            )}

            {/* Display */}
            {activeSection === "display" && (
              <SectionCard>
                <div className="flex items-center justify-between">
                  <SectionTitle
                    title={t("settings:display.title")}
                    description={t("settings:display.description")}
                  />
                  <button
                    onClick={handleThemeToggle}
                    className="px-3 py-2 rounded-lg border text-sm"
                    style={{
                      background: "var(--bg-elevated)",
                      color: isDarkMode ? "var(--accent)" : "var(--text-primary)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    {display.theme === "dark"
                      ? t("settings:display.theme.darkMode") +
                        " " +
                        t("settings:display.theme.active")
                      : t("settings:display.theme.lightMode") +
                        " " +
                        t("settings:display.theme.active")}
                  </button>
                </div>

                <InlineHelp
                  title={t("settings:display.theme.title")}
                  category="basic"
                  content={
                    <div className="space-y-2">
                      <p>{t("settings:display.theme.description")}</p>
                      <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                        <li>
                          <strong>{t("settings:display.theme.lightMode")}:</strong>{" "}
                          {t("settings:display.theme.lightDescription")}
                        </li>
                        <li>
                          <strong>{t("settings:display.theme.darkMode")}:</strong>{" "}
                          {t("settings:display.theme.darkDescription")}
                        </li>
                        <li>{t("settings:display.theme.autoSave")}</li>
                      </ul>
                    </div>
                  }
                />

                <div>
                  <label className="label">{t("settings:display.language")}</label>
                  <select
                    value={display.language}
                    onChange={(e) => {
                      const newLang = e.target.value as "de" | "en";
                      void changeLanguage(newLang);
                    }}
                    className="input"
                  >
                    <option value="de">{t("settings:display.languages.de")}</option>
                    <option value="en">{t("settings:display.languages.en")}</option>
                  </select>
                </div>

                <div>
                  <label className="label">{t("settings:display.timezone")}</label>
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
                    <label className="label">{t("settings:display.dateFormat")}</label>
                    <select
                      value={display.dateFormat}
                      onChange={(e) =>
                        setDisplay({ dateFormat: e.target.value as typeof display.dateFormat })
                      }
                      className="input"
                    >
                      <option value="DD.MM.YYYY">DD.MM.YYYY</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t("settings:display.timeFormat")}</label>
                    <select
                      value={display.timeFormat}
                      onChange={(e) =>
                        setDisplay({ timeFormat: e.target.value as typeof display.timeFormat })
                      }
                      className="input"
                    >
                      <option value="24h">24h</option>
                      <option value="12h">12h AM/PM</option>
                    </select>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Units */}
            {activeSection === "units" && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:units.title")}
                  description={t("settings:units.description")}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t("settings:units.distance")}</label>
                    <select
                      value={units.distanceUnit}
                      onChange={(e) =>
                        setUnits({ distanceUnit: e.target.value as typeof units.distanceUnit })
                      }
                      className="input"
                    >
                      <option value="kilometers">{t("settings:units.options.kilometers")}</option>
                      <option value="miles">{t("settings:units.options.miles")}</option>
                      <option value="nautical_miles">
                        {t("settings:units.options.nautical_miles")}
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t("settings:units.currency")}</label>
                    <select
                      value={units.currency}
                      onChange={(e) =>
                        setUnits({ currency: e.target.value as typeof units.currency })
                      }
                      className="input"
                    >
                      <option value="EUR">{t("settings:units.options.EUR")}</option>
                      <option value="USD">{t("settings:units.options.USD")}</option>
                      <option value="GBP">{t("settings:units.options.GBP")}</option>
                      <option value="CHF">{t("settings:units.options.CHF")}</option>
                    </select>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Defaults */}
            {activeSection === "defaults" && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:defaults.title")}
                  description={t("settings:defaults.description")}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t("settings:defaults.flightStatus")}</label>
                    <select
                      value={defaults.flightStatus}
                      onChange={(e) =>
                        setDefaults({
                          flightStatus: e.target.value as typeof defaults.flightStatus,
                        })
                      }
                      className="input"
                    >
                      <option value="scheduled">{t("settings:defaults.options.scheduled")}</option>
                      <option value="flown">{t("settings:defaults.options.flown")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t("settings:defaults.seatClass")}</label>
                    <select
                      value={defaults.seatClass}
                      onChange={(e) =>
                        setDefaults({ seatClass: e.target.value as typeof defaults.seatClass })
                      }
                      className="input"
                    >
                      <option value="economy">{t("settings:defaults.options.economy")}</option>
                      <option value="premium_economy">
                        {t("settings:defaults.options.premium_economy")}
                      </option>
                      <option value="business">{t("settings:defaults.options.business")}</option>
                      <option value="first">{t("settings:defaults.options.first")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t("settings:defaults.favoriteAirline")}</label>
                    <input
                      type="text"
                      value={defaults.favoriteAirline}
                      onChange={(e) => setDefaults({ favoriteAirline: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">{t("settings:defaults.flightCategory")}</label>
                    <select
                      value={defaults.flightCategory}
                      onChange={(e) =>
                        setDefaults({
                          flightCategory: e.target.value as typeof defaults.flightCategory,
                        })
                      }
                      className="input"
                    >
                      <option value="business">{t("settings:defaults.options.business")}</option>
                      <option value="private">{t("settings:defaults.options.private")}</option>
                      <option value="vacation">{t("settings:defaults.options.vacation")}</option>
                    </select>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Map */}
            {activeSection === "map" && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:map.title")}
                  description={t("settings:map.description")}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t("settings:map.mapStyle")}</label>
                    <select
                      value={map.mapStyle}
                      onChange={(e) => setMap({ mapStyle: e.target.value as typeof map.mapStyle })}
                      className="input"
                    >
                      <option value="osm">{t("settings:map.options.osm")}</option>
                      <option value="satellite">{t("settings:map.options.satellite")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t("settings:map.zoomLevel")}</label>
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
                    <label className="label">{t("settings:map.markerStyle")}</label>
                    <select
                      value={map.markerStyle}
                      onChange={(e) =>
                        setMap({ markerStyle: e.target.value as typeof map.markerStyle })
                      }
                      className="input"
                    >
                      <option value="pin">{t("settings:map.options.pin")}</option>
                      <option value="circle">{t("settings:map.options.circle")}</option>
                      <option value="custom">{t("settings:map.options.custom")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t("settings:map.routeColor")}</label>
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
                            style={{
                              backgroundColor: color,
                              border: "1px solid var(--color-border)",
                            }}
                            className="w-8 h-8 rounded-md"
                            aria-label={"Farbe " + color}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Notifications */}
            {activeSection === "notifications" && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:notifications.title")}
                  description={t("settings:notifications.description")}
                />
                <div className="space-y-3">
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={notifications.emailNotifications}
                      onChange={(e) => setNotifications({ emailNotifications: e.target.checked })}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:notifications.emailNotifications")}
                    </span>
                  </label>
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={notifications.checkInReminder}
                      onChange={(e) => setNotifications({ checkInReminder: e.target.checked })}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:notifications.checkInReminder")}
                    </span>
                  </label>
                  <div>
                    <label className="label">{t("settings:notifications.flightReminder")}</label>
                    <select
                      value={notifications.flightReminder}
                      onChange={(e) =>
                        setNotifications({
                          flightReminder: e.target.value as typeof notifications.flightReminder,
                        })
                      }
                      className="input"
                    >
                      <option value="off">{t("settings:notifications.options.off")}</option>
                      <option value="24h">{t("settings:notifications.options.24h")}</option>
                      <option value="48h">{t("settings:notifications.options.48h")}</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={notifications.featureUpdates}
                      onChange={(e) => setNotifications({ featureUpdates: e.target.checked })}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:notifications.featureUpdates")}
                    </span>
                  </label>
                </div>
              </SectionCard>
            )}

            {/* Privacy */}
            {activeSection === "privacy" && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:privacy.title")}
                  description={t("settings:privacy.description")}
                />
                <div className="space-y-3">
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={privacy.twoFactorAuth}
                      onChange={(e) => setPrivacy({ twoFactorAuth: e.target.checked })}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:privacy.twoFactorAuth")}
                    </span>
                  </label>
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={privacy.loginAlerts}
                      onChange={(e) => setPrivacy({ loginAlerts: e.target.checked })}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:privacy.loginAlerts")}
                    </span>
                  </label>
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={privacy.analyticsOptIn ?? false}
                      onChange={(e) => setPrivacy({ analyticsOptIn: e.target.checked })}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:privacy.analyticsOptIn")}
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      className="btn-secondary"
                      onClick={() => setPrivacy({ dataExportRequested: true })}
                    >
                      {t("settings:privacy.dataExport")}
                    </button>
                    {privacy.dataExportRequested && (
                      <span className="text-sm" style={{ color: "var(--success)" }}>
                        {t("settings:privacy.dataExportRequested")}
                      </span>
                    )}
                  </div>
                </div>
              </SectionCard>
            )}
            {/* Backup */}
            {activeSection === "backup" && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:backup.title")}
                  description={t("settings:backup.description")}
                />
                <div className="space-y-3">
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={backup.autoBackup}
                      onChange={(e) => setBackup({ autoBackup: e.target.checked })}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:backup.autoBackup")}
                    </span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">{t("settings:backup.backupInterval")}</label>
                      <select
                        value={backup.backupInterval}
                        onChange={(e) =>
                          setBackup({
                            backupInterval: e.target.value as typeof backup.backupInterval,
                          })
                        }
                        className="input"
                      >
                        <option value="daily">{t("settings:backup.intervals.daily")}</option>
                        <option value="weekly">{t("settings:backup.intervals.weekly")}</option>
                        <option value="monthly">{t("settings:backup.intervals.monthly")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">{t("settings:backup.exportFormat")}</label>
                      <select
                        value={backup.exportFormat}
                        onChange={(e) =>
                          setBackup({ exportFormat: e.target.value as typeof backup.exportFormat })
                        }
                        className="input"
                      >
                        <option value="json">{t("settings:backup.formats.json")}</option>
                        <option value="csv">{t("settings:backup.formats.csv")}</option>
                        <option value="pdf">{t("settings:backup.formats.pdf")}</option>
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={backup.cloudSync}
                      onChange={(e) => setBackup({ cloudSync: e.target.checked })}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:backup.cloudSync")}
                    </span>
                  </label>
                  <div>
                    <label className="label">{t("settings:backup.retentionDays")}</label>
                    <input
                      type="number"
                      value={retentionDays}
                      onChange={(e) => setRetentionDays(parseInt(e.target.value, 10) || 30)}
                      min="1"
                      max="365"
                      className="input"
                    />
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {t("settings:backup.retentionDaysDescription", { days: retentionDays })}
                    </p>
                  </div>
                  {user?.isAdmin && (
                    <>
                      <div className="pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
                        <p
                          className="text-sm font-medium mb-2"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {t("settings:backup.status.title")}
                        </p>
                        {backupStatus?.running ? (
                          <div
                            className="flex items-center gap-2"
                            style={{ color: "var(--accent)" }}
                          >
                            <span className="animate-pulse">&#9679;</span>
                            <span>{t("settings:backup.status.running")}</span>
                          </div>
                        ) : lastBackup ? (
                          <div className="space-y-1">
                            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                              {t("settings:backup.status.lastBackup", {
                                date: lastBackup.completedAt
                                  ? new Date(lastBackup.completedAt).toLocaleString("de-DE")
                                  : "-",
                              })}
                            </p>
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {t("settings:backup.status.size", {
                                size: (parseInt(lastBackup.size, 10) / 1024 / 1024).toFixed(2),
                              })}
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                            {t("settings:backup.status.noBackup")}
                          </p>
                        )}
                      </div>
                      <div className="pt-2">
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {t("settings:backup.status.path", { path: "/app/data/backups" })}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </SectionCard>
            )}
            {/* Parser */}
            {activeSection === "parser" && (
              <SectionCard>
                <SectionTitle
                  title="Boarding Pass Parsing"
                  description="Wählen Sie die Strategie für das Parsing von Boarding-Pässen"
                />
                <InlineHelp
                  title="Boarding Pass Parsing Strategien"
                  category="basic"
                  content={
                    <div className="space-y-2">
                      <p>
                        Die App unterstützt verschiedene Strategien für das Parsing von
                        Boarding-Pässen:
                      </p>
                      <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                        <li>
                          <strong>Automatisch:</strong> LLM wird bevorzugt (wenn verfügbar), sonst
                          Barcode-Parser mit LLM-Fallback
                        </li>
                        <li>
                          <strong>Nur Parser:</strong> Nur schneller Frontend-Parser, kein API-Call
                          (offline, kostenlos)
                        </li>
                        <li>
                          <strong>Parser + API Kontrolle:</strong> Parser für Geschwindigkeit, API
                          zur Validierung
                        </li>
                        <li>
                          <strong>Nur API:</strong> Direkt LLM/API verwenden (robust, funktioniert
                          für alle Airlines)
                        </li>
                      </ul>
                    </div>
                  }
                />
                <div>
                  <label className="label">Parsing-Strategie</label>
                  <select
                    value={boardingPassParserStrategy || "auto"}
                    onChange={async (e) => {
                      const value =
                        e.target.value === "auto"
                          ? null
                          : (e.target.value as "parser-only" | "parser-with-api" | "api-only");
                      setBoardingPassParserStrategy(value);
                      try {
                        await settingsApi.update({ boardingPassParserStrategy: value });
                        addToast("success", "Boarding Pass Parser-Strategie gespeichert");
                      } catch (error) {
                        logger.error("Failed to save boarding pass parser strategy:", error);
                        addToast("error", "Fehler beim Speichern");
                      }
                    }}
                    className="input"
                  >
                    <option value="auto">Automatisch (Empfohlen)</option>
                    <option value="parser-only">Nur Parser</option>
                    <option value="parser-with-api">Parser + API Kontrolle</option>
                    <option value="api-only">Nur API</option>
                  </select>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {boardingPassParserStrategy === null
                      ? "LLM wird bevorzugt, wenn verfügbar. Sonst Barcode-Parser mit LLM-Fallback."
                      : boardingPassParserStrategy === "parser-only"
                        ? "Nur Frontend-Parser. Schnell, kostenlos, offline. Kein Fallback."
                        : boardingPassParserStrategy === "parser-with-api"
                          ? "Parser für Geschwindigkeit, API zur Validierung. Beste Balance."
                          : "Direkt LLM/API verwenden. Robust, funktioniert für alle Airlines."}
                  </p>
                </div>
                <ParserConfiguration />
              </SectionCard>
            )}
            {/* Auto-Update */}
            {activeSection === "autoupdate" && (
              <SectionCard>
                <div className="flex items-center justify-between">
                  <SectionTitle
                    title={t("settings:autoUpdate.title")}
                    description={t("settings:autoUpdate.description")}
                  />
                  <Link
                    to="/pending-updates"
                    className="text-sm font-medium"
                    style={{ color: "var(--accent)" }}
                  >
                    {t("settings:autoUpdate.viewPending")} →
                  </Link>
                </div>
                <InlineHelp
                  title={t("settings:autoUpdate.info.title")}
                  category="basic"
                  content={
                    <div className="space-y-3">
                      <p>{t("settings:autoUpdate.info.description")}</p>
                      <div>
                        <p className="font-semibold mb-2">
                          {t("settings:autoUpdate.info.benefits.title")}
                        </p>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                          <li>{t("settings:autoUpdate.info.benefits.realTime")}</li>
                          <li>{t("settings:autoUpdate.info.benefits.automatic")}</li>
                          <li>{t("settings:autoUpdate.info.benefits.review")}</li>
                          <li>{t("settings:autoUpdate.info.benefits.accurate")}</li>
                          <li>{t("settings:autoUpdate.info.benefits.timeSaving")}</li>
                        </ul>
                      </div>
                      <div
                        className="rounded-lg p-3"
                        style={{
                          background: "rgba(232,160,69,0.1)",
                          border: "1px solid rgba(232,160,69,0.3)",
                        }}
                      >
                        <p
                          className="font-semibold mb-1 text-sm"
                          style={{ color: "var(--accent)" }}
                        >
                          {t("settings:autoUpdate.info.requirement.title")}
                        </p>
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                          {t("settings:autoUpdate.info.requirement.description")}
                        </p>
                      </div>
                    </div>
                  }
                />
                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={autoUpdateSettings.enabled}
                      onChange={(e) =>
                        setAutoUpdateSettings({ ...autoUpdateSettings, enabled: e.target.checked })
                      }
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:autoUpdate.enabled") || "Automatische Updates aktivieren"}
                    </span>
                  </label>
                  {autoUpdateSettings.enabled && (
                    <>
                      <label className="flex items-center gap-3">
                        <AmberToggle
                          checked={autoUpdateSettings.requireApproval}
                          onChange={(e) =>
                            setAutoUpdateSettings({
                              ...autoUpdateSettings,
                              requireApproval: e.target.checked,
                            })
                          }
                        />
                        <span style={{ color: "var(--text-primary)" }}>
                          {t("settings:autoUpdate.requireApproval") || "Bestätigung erforderlich"}
                        </span>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="label">{t("settings:autoUpdate.checkInterval")}</label>
                          <input
                            type="number"
                            value={autoUpdateSettings.checkInterval}
                            onChange={(e) => {
                              const value = parseInt(e.target.value, 10);
                              if (value >= 5 && value <= 1440) {
                                setAutoUpdateSettings({
                                  ...autoUpdateSettings,
                                  checkInterval: value,
                                });
                              }
                            }}
                            min="5"
                            max="1440"
                            className="input"
                          />
                          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                            {t("settings:autoUpdate.checkIntervalDescription")}
                          </p>
                        </div>
                        <div>
                          <label className="label">{t("settings:autoUpdate.expiryHours")}</label>
                          <input
                            type="number"
                            value={autoUpdateSettings.expiryHours}
                            onChange={(e) => {
                              const value = parseInt(e.target.value, 10);
                              if (value >= 1 && value <= 168) {
                                setAutoUpdateSettings({
                                  ...autoUpdateSettings,
                                  expiryHours: value,
                                });
                              }
                            }}
                            min="1"
                            max="168"
                            className="input"
                          />
                          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                            {t("settings:autoUpdate.expiryHoursDescription")}
                          </p>
                        </div>
                      </div>
                      <label className="flex items-center gap-3">
                        <AmberToggle
                          checked={autoUpdateSettings.onlyDuringFlight}
                          onChange={(e) =>
                            setAutoUpdateSettings({
                              ...autoUpdateSettings,
                              onlyDuringFlight: e.target.checked,
                            })
                          }
                        />
                        <span style={{ color: "var(--text-primary)" }}>
                          {t("settings:autoUpdate.onlyDuringFlight") || "Nur während Flugzeit"}
                        </span>
                      </label>
                    </>
                  )}
                  <div
                    className="flex justify-end pt-4"
                    style={{ borderTop: "1px solid var(--color-border)" }}
                  >
                    <button
                      onClick={saveAutoUpdateSettings}
                      disabled={loadingAutoUpdateSettings}
                      className="btn-primary"
                      style={{ boxShadow: "0 0 16px rgba(232,160,69,0.25)" }}
                    >
                      {loadingAutoUpdateSettings
                        ? t("common:buttons.saving") || "Speichern..."
                        : t("common:buttons.save") || "Speichern"}
                    </button>
                  </div>
                </div>
              </SectionCard>
            )}
            {/* Enrichment */}
            {activeSection === "enrichment" && (
              <SectionCard>
                <div className="flex items-center gap-2">
                  <SectionTitle
                    title={
                      t("settings:historicalEnrichment.title") || "Historische Anreicherung (Beta)"
                    }
                    description={
                      t("settings:historicalEnrichment.description") ||
                      "Ergänzt historische Flüge (2-5 Jahre) mit Daten von Live-getrackten Flügen derselben Flugnummer"
                    }
                  />
                  <span
                    className="px-2 py-0.5 text-xs font-semibold rounded-full self-start mt-1"
                    style={{ background: "rgba(232,160,69,0.15)", color: "var(--accent)" }}
                  >
                    Beta
                  </span>
                </div>
                <InlineHelp
                  title={t("settings:historicalEnrichment.info.title")}
                  category="basic"
                  content={
                    <div className="space-y-3">
                      <p>{t("settings:historicalEnrichment.info.description")}</p>
                      <div>
                        <p className="font-semibold mb-2">
                          {t("settings:historicalEnrichment.info.benefits.title")}
                        </p>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                          <li>{t("settings:historicalEnrichment.info.benefits.completeData")}</li>
                          <li>{t("settings:historicalEnrichment.info.benefits.routeTracking")}</li>
                          <li>{t("settings:historicalEnrichment.info.benefits.statistics")}</li>
                          <li>{t("settings:historicalEnrichment.info.benefits.automatic")}</li>
                        </ul>
                      </div>
                      <div
                        className="rounded-lg p-3"
                        style={{
                          background: "rgba(232,160,69,0.1)",
                          border: "1px solid rgba(232,160,69,0.3)",
                        }}
                      >
                        <p
                          className="font-semibold mb-1 text-sm"
                          style={{ color: "var(--accent)" }}
                        >
                          {t("settings:historicalEnrichment.info.warning.title")}
                        </p>
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                          {t("settings:historicalEnrichment.info.warning.description")}
                        </p>
                      </div>
                    </div>
                  }
                />
                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <AmberToggle
                      checked={historicalEnrichmentSettings.enabled}
                      onChange={(e) =>
                        setHistoricalEnrichmentSettings({
                          ...historicalEnrichmentSettings,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("settings:historicalEnrichment.enabled") ||
                        "Historische Flugdaten-Anreicherung aktivieren"}
                    </span>
                  </label>
                  {historicalEnrichmentSettings.enabled && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="label">
                            {t("settings:historicalEnrichment.minConfidence") ||
                              "Min Confidence (%)"}
                          </label>
                          <input
                            type="number"
                            value={historicalEnrichmentSettings.minConfidence}
                            onChange={(e) => {
                              const value = parseInt(e.target.value, 10);
                              if (value >= 0 && value <= 100) {
                                setHistoricalEnrichmentSettings({
                                  ...historicalEnrichmentSettings,
                                  minConfidence: value,
                                });
                              }
                            }}
                            min="0"
                            max="100"
                            className="input"
                          />
                          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                            {t("settings:historicalEnrichment.minConfidenceDescription") ||
                              "Nur Anreicherungen mit mindestens X% Confidence anzeigen"}
                          </p>
                        </div>
                        <div>
                          <label className="label">
                            {t("settings:historicalEnrichment.maxPerDay") || "Max pro Tag"}
                          </label>
                          <input
                            type="number"
                            value={historicalEnrichmentSettings.maxPerDay}
                            onChange={(e) => {
                              const value = parseInt(e.target.value, 10);
                              if (value >= 10 && value <= 200) {
                                setHistoricalEnrichmentSettings({
                                  ...historicalEnrichmentSettings,
                                  maxPerDay: value,
                                });
                              }
                            }}
                            min="10"
                            max="200"
                            className="input"
                          />
                          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                            {t("settings:historicalEnrichment.maxPerDayDescription") ||
                              "Maximale Anzahl Anreicherungen pro Tag"}
                          </p>
                        </div>
                        <div>
                          <label className="label">
                            {t("settings:historicalEnrichment.maxAgeYears") || "Max Alter (Jahre)"}
                          </label>
                          <input
                            type="number"
                            value={historicalEnrichmentSettings.maxAgeYears}
                            onChange={(e) => {
                              const value = parseInt(e.target.value, 10);
                              if (value >= 2 && value <= 10) {
                                setHistoricalEnrichmentSettings({
                                  ...historicalEnrichmentSettings,
                                  maxAgeYears: value,
                                });
                              }
                            }}
                            min="2"
                            max="10"
                            className="input"
                          />
                          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                            {t("settings:historicalEnrichment.maxAgeYearsDescription") ||
                              "Maximales Alter von Flügen für Anreicherung"}
                          </p>
                        </div>
                      </div>
                      <label className="flex items-center gap-3">
                        <AmberToggle
                          checked={historicalEnrichmentSettings.autoProcess}
                          onChange={(e) =>
                            setHistoricalEnrichmentSettings({
                              ...historicalEnrichmentSettings,
                              autoProcess: e.target.checked,
                            })
                          }
                        />
                        <span style={{ color: "var(--text-primary)" }}>
                          {t("settings:historicalEnrichment.autoProcess") ||
                            "Automatisch nachts nach Anreicherungs-Kandidaten suchen"}
                        </span>
                      </label>
                      <label className="flex items-center gap-3">
                        <AmberToggle
                          checked={historicalEnrichmentSettings.requireApproval}
                          onChange={(e) =>
                            setHistoricalEnrichmentSettings({
                              ...historicalEnrichmentSettings,
                              requireApproval: e.target.checked,
                            })
                          }
                        />
                        <span style={{ color: "var(--text-primary)" }}>
                          {t("settings:historicalEnrichment.requireApproval") ||
                            "Jede Anreicherung muss manuell bestätigt werden"}
                        </span>
                      </label>
                    </>
                  )}
                  <div
                    className="flex justify-end pt-4"
                    style={{ borderTop: "1px solid var(--color-border)" }}
                  >
                    <button
                      onClick={saveHistoricalEnrichmentSettings}
                      disabled={loadingHistoricalEnrichmentSettings}
                      className="btn-primary"
                      style={{ boxShadow: "0 0 16px rgba(232,160,69,0.25)" }}
                    >
                      {loadingHistoricalEnrichmentSettings
                        ? t("common:buttons.saving") || "Speichern..."
                        : t("common:buttons.save") || "Speichern"}
                    </button>
                  </div>
                </div>
              </SectionCard>
            )}
            {/* API Keys */}
            {activeSection === "apikeys" && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:apiKeys.title")}
                  description={t("settings:apiKeys.description")}
                />
                <div className="space-y-6">
                  <div>
                    <h3
                      className="text-lg font-medium mb-3"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {t("settings:apiKeys.parserApis")}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <ApiKeyCard
                        provider="openai"
                        label={t("settings:apiKeys.openai.label")}
                        description={t("settings:apiKeys.openai.description")}
                        getKeyUrl="https://platform.openai.com/api-keys"
                        isShared={apiKeysStatus?.openai.isShared || false}
                        hasAccess={apiKeysStatus?.openai.hasAccess || false}
                        value={apiKeys.openaiApiKey}
                        onChange={(value) => setApiKeys({ ...apiKeys, openaiApiKey: value })}
                        onClear={() => setApiKeys({ ...apiKeys, openaiApiKey: "" })}
                      />
                      <ApiKeyCard
                        provider="claude"
                        label={t("settings:apiKeys.claude.label")}
                        description={t("settings:apiKeys.claude.description")}
                        getKeyUrl="https://console.anthropic.com/settings/keys"
                        isShared={apiKeysStatus?.claude.isShared || false}
                        hasAccess={apiKeysStatus?.claude.hasAccess || false}
                        value={apiKeys.claudeApiKey}
                        onChange={(value) => setApiKeys({ ...apiKeys, claudeApiKey: value })}
                        onClear={() => setApiKeys({ ...apiKeys, claudeApiKey: "" })}
                      />
                    </div>
                  </div>
                  <div>
                    <h3
                      className="text-lg font-medium mb-3"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {t("settings:apiKeys.flightApis")}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <ApiKeyCard
                        provider="airlabs"
                        label={t("settings:apiKeys.airlabs.label")}
                        description={t("settings:apiKeys.airlabs.description")}
                        getKeyUrl="https://airlabs.co/account"
                        isShared={apiKeysStatus?.airlabs.isShared || false}
                        hasAccess={apiKeysStatus?.airlabs.hasAccess || false}
                        value={apiKeys.airlabsApiKey}
                        onChange={(value) => setApiKeys({ ...apiKeys, airlabsApiKey: value })}
                        onClear={() => setApiKeys({ ...apiKeys, airlabsApiKey: "" })}
                      />
                      <ApiKeyCard
                        provider="aviationstack"
                        label={t("settings:apiKeys.aviationstack.label")}
                        description={t("settings:apiKeys.aviationstack.description")}
                        getKeyUrl="https://aviationstack.com/signup"
                        isShared={apiKeysStatus?.aviationstack.isShared || false}
                        hasAccess={apiKeysStatus?.aviationstack.hasAccess || false}
                        value={apiKeys.aviationstackApiKey}
                        onChange={(value) => setApiKeys({ ...apiKeys, aviationstackApiKey: value })}
                        onClear={() => setApiKeys({ ...apiKeys, aviationstackApiKey: "" })}
                      />
                      <ApiKeyCard
                        provider="opensky"
                        label={t("settings:apiKeys.opensky.label")}
                        description={t("settings:apiKeys.opensky.description")}
                        getKeyUrl="https://opensky-network.org/accounts/register"
                        isShared={apiKeysStatus?.opensky.isShared || false}
                        hasAccess={apiKeysStatus?.opensky.hasAccess || false}
                        openskyFields={{
                          clientId: apiKeys.openskyClientId,
                          clientSecret: apiKeys.openskyClientSecret,
                          onClientIdChange: (value) =>
                            setApiKeys({ ...apiKeys, openskyClientId: value }),
                          onClientSecretChange: (value) =>
                            setApiKeys({ ...apiKeys, openskyClientSecret: value }),
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div
                  className="flex justify-end gap-2 pt-4"
                  style={{ borderTop: "1px solid var(--color-border)" }}
                >
                  <button
                    onClick={async () => {
                      setLoadingApiKeys(true);
                      try {
                        await settingsApi.updateApiKeys(apiKeys);
                        addToast(
                          "success",
                          t("settings:apiKeys.saved") || "API keys saved successfully"
                        );
                        const status = await settingsApi.getApiKeys();
                        setApiKeysStatus(status);
                        setApiKeys({
                          openaiApiKey: "",
                          claudeApiKey: "",
                          airlabsApiKey: "",
                          aviationstackApiKey: "",
                          openskyClientId: "",
                          openskyClientSecret: "",
                        });
                      } catch (error: unknown) {
                        logger.error("Failed to save API keys:", error);
                        const axiosError = error as { response?: { data?: { error?: string } } };
                        addToast(
                          "error",
                          axiosError.response?.data?.error ||
                            t("settings:apiKeys.saveFailed") ||
                            "Failed to save API keys"
                        );
                      } finally {
                        setLoadingApiKeys(false);
                      }
                    }}
                    disabled={loadingApiKeys}
                    className="btn-primary"
                    style={{ boxShadow: "0 0 16px rgba(232,160,69,0.25)" }}
                  >
                    {loadingApiKeys
                      ? t("settings:apiKeys.saving") || "Saving..."
                      : t("settings:apiKeys.save") || "Save API Keys"}
                  </button>
                </div>
              </SectionCard>
            )}
            {/* Training */}
            {activeSection === "training" && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:training.title")}
                  description={t("settings:training.description")}
                />
                <InlineHelp
                  title={t("settings:training.help.title")}
                  category="expert"
                  content={
                    <div className="space-y-3">
                      <p>{t("settings:training.help.description")}</p>
                      <div>
                        <p className="font-semibold mb-1">
                          {t("settings:training.help.optionsTitle")}
                        </p>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                          <li>
                            <strong>{t("settings:training.useTrainedModels")}:</strong>{" "}
                            {t("settings:training.help.options.useTrainedModels")}
                          </li>
                          <li>
                            <strong>{t("settings:training.preferredEmailModel")}:</strong>{" "}
                            {t("settings:training.help.options.preferredEmailModel")}
                          </li>
                          <li>
                            <strong>{t("settings:training.preferredVisionModel")}:</strong>{" "}
                            {t("settings:training.help.options.preferredVisionModel")}
                          </li>
                          <li>
                            <strong>{t("settings:training.trainingSeparateModels")}:</strong>{" "}
                            {t("settings:training.help.options.trainingSeparateModels")}
                          </li>
                        </ul>
                      </div>
                    </div>
                  }
                />
                <div className="space-y-4">
                  <div
                    className="flex items-center justify-between p-4 rounded-lg"
                    style={{ background: "var(--bg-elevated)" }}
                  >
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                        {t("settings:training.useTrainedModels")}
                      </h3>
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                        {t("settings:training.useTrainedModelsDescription")}
                      </p>
                    </div>
                    <AmberToggle
                      checked={trainingSettings.useTrainedModels}
                      onChange={(e) =>
                        setTrainingSettings({
                          ...trainingSettings,
                          useTrainedModels: e.target.checked,
                        })
                      }
                    />
                  </div>
                  <div className="p-4 rounded-lg" style={{ background: "var(--bg-elevated)" }}>
                    <label className="label">{t("settings:training.preferredEmailModel")}</label>
                    <select
                      value={trainingSettings.preferredEmailModel}
                      onChange={(e) =>
                        setTrainingSettings({
                          ...trainingSettings,
                          preferredEmailModel: e.target.value as "auto" | "trained" | "base",
                        })
                      }
                      className="input"
                    >
                      <option value="auto">{t("settings:training.modelOptions.auto")}</option>
                      <option value="trained">{t("settings:training.modelOptions.trained")}</option>
                      <option value="base">{t("settings:training.modelOptions.base")}</option>
                    </select>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {t("settings:training.preferredEmailModelDescription")}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg" style={{ background: "var(--bg-elevated)" }}>
                    <label className="label">{t("settings:training.preferredVisionModel")}</label>
                    <select
                      value={trainingSettings.preferredVisionModel}
                      onChange={(e) =>
                        setTrainingSettings({
                          ...trainingSettings,
                          preferredVisionModel: e.target.value as "auto" | "trained" | "base",
                        })
                      }
                      className="input"
                    >
                      <option value="auto">{t("settings:training.modelOptions.auto")}</option>
                      <option value="trained">{t("settings:training.modelOptions.trained")}</option>
                      <option value="base">{t("settings:training.modelOptions.base")}</option>
                    </select>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {t("settings:training.preferredVisionModelDescription")}
                    </p>
                  </div>
                  <div
                    className="flex items-center justify-between p-4 rounded-lg"
                    style={{ background: "var(--bg-elevated)" }}
                  >
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                        {t("settings:training.trainingSeparateModels")}
                      </h3>
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                        {t("settings:training.trainingSeparateModelsDescription")}
                      </p>
                    </div>
                    <AmberToggle
                      checked={trainingSettings.trainingSeparateModels}
                      onChange={(e) =>
                        setTrainingSettings({
                          ...trainingSettings,
                          trainingSeparateModels: e.target.checked,
                        })
                      }
                    />
                  </div>
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleTrainingSettingsUpdate}
                      disabled={loadingTrainingSettings}
                      className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ boxShadow: "0 0 16px rgba(232,160,69,0.25)" }}
                    >
                      {loadingTrainingSettings
                        ? t("settings:training.savingSettings")
                        : t("settings:training.saveSettings")}
                    </button>
                  </div>
                </div>
              </SectionCard>
            )}
            {/* Developer */}
            {activeSection === "developer" && hasTrainingAccess && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:developer.title")}
                  description={t("settings:developer.description")}
                />
                <InlineHelp
                  title={t("settings:developer.help.title")}
                  category="expert"
                  content={
                    <div className="space-y-3">
                      <p>{t("settings:developer.help.description")}</p>
                      <div>
                        <p className="font-semibold mb-1">
                          {t("settings:developer.help.features.title")}
                        </p>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                          <li>{t("settings:developer.help.features.items.trainingPage")}</li>
                          <li>{t("settings:developer.help.features.items.uploadAnnotation")}</li>
                          <li>{t("settings:developer.help.features.items.loraTraining")}</li>
                          <li>{t("settings:developer.help.features.items.parserAccuracy")}</li>
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold mb-1">
                          {t("settings:developer.help.requirements.title")}
                        </p>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                          <li>{t("settings:developer.help.requirements.items.ollama")}</li>
                          <li>{t("settings:developer.help.requirements.items.hardware")}</li>
                          <li>{t("settings:developer.help.requirements.items.trainingData")}</li>
                        </ul>
                      </div>
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                        <strong>{t("settings:developer.help.noteLabel")}:</strong>{" "}
                        {t("settings:developer.help.note")}
                      </p>
                    </div>
                  }
                />
                <div className="space-y-4">
                  <div
                    className="flex items-center justify-between p-4 rounded-lg"
                    style={{ background: "var(--bg-elevated)" }}
                  >
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                        {t("settings:developer.modeTitle")}
                      </h3>
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                        {t("settings:developer.modeDescription")}
                      </p>
                    </div>
                    <AmberToggle
                      checked={developerModeEnabled}
                      onChange={handleDeveloperModeToggle}
                      disabled={loadingDeveloperMode}
                    />
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Admin */}
            {activeSection === "admin" && user?.isAdmin && (
              <SectionCard>
                <SectionTitle
                  title={t("settings:admin.title")}
                  description={t("settings:admin.description")}
                />
                <Link
                  to="/admin"
                  className="inline-flex items-center px-4 py-2 font-medium rounded-lg transition-colors"
                  style={{
                    background: "var(--accent)",
                    color: "#0d1117",
                    boxShadow: "0 0 16px rgba(232,160,69,0.25)",
                  }}
                >
                  <svg
                    className="w-5 h-5 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  {t("settings:admin.openAdminPanel")}
                </Link>
              </SectionCard>
            )}
            {/* About */}
            {activeSection === "about" && (
              <SectionCard>
                <SectionTitle title="About TravStats" />
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  TravStats - Flight Statistics Tracking Application
                </p>
                <div className="rounded-lg p-4" style={{ background: "var(--bg-elevated)" }}>
                  <p className="text-sm mb-2" style={{ color: "var(--text-primary)" }}>
                    <strong>License:</strong> GNU Affero General Public License v3.0 (AGPL-3.0)
                  </p>
                  <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                    Copyright © 2025 Dennis Wittke
                  </p>
                  <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                    This program is free software: you can redistribute it and/or modify it under
                    the terms of the GNU Affero General Public License. If you run this software as
                    a web service, you must make the complete source code available under AGPL-3.0.
                  </p>
                  <a
                    href="https://github.com/Abrechen2/TravStats"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 font-medium rounded-lg transition-colors text-sm"
                    style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
                  >
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                      <path
                        fillRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                    View Source Code on GitHub
                  </a>
                </div>
              </SectionCard>
            )}

            {/* Auto-saved notice */}
            <div
              className="rounded-lg p-4 text-sm flex items-center justify-between"
              style={{
                background: "rgba(63,185,80,0.08)",
                border: "1px solid rgba(63,185,80,0.2)",
              }}
            >
              <div>
                <p className="font-semibold" style={{ color: "var(--success)" }}>
                  {t("settings:autoSaved.title")}
                </p>
                <p style={{ color: "var(--text-muted)" }}>{t("settings:autoSaved.description")}</p>
              </div>
              <button
                className="btn-secondary"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              >
                {t("settings:scrollToTop")}
              </button>
            </div>
          </main>
        </div>
      </div>
      {/* Developer Confirmation Dialog */}
      {showDeveloperConfirm && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
          >
            <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("settings:developer.confirmTitle")}
            </h3>
            <div className="space-y-3 mb-6">
              <p style={{ color: "var(--text-muted)" }}>{t("settings:developer.confirmMessage")}</p>
              <div
                className="rounded-lg p-4"
                style={{
                  background: "rgba(210,153,34,0.1)",
                  border: "1px solid rgba(210,153,34,0.3)",
                }}
              >
                <p className="text-sm font-semibold mb-2" style={{ color: "var(--warning)" }}>
                  {t("settings:developer.risks.title")}
                </p>
                <ul
                  className="text-sm space-y-1 list-disc list-inside"
                  style={{ color: "var(--text-muted)" }}
                >
                  <li>{t("settings:developer.risks.items.resourceUsage")}</li>
                  <li>{t("settings:developer.risks.items.technicalKnowledge")}</li>
                  <li>{t("settings:developer.risks.items.unexpectedResults")}</li>
                  <li>{t("settings:developer.risks.items.longTraining")}</li>
                </ul>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeveloperConfirm(false)}
                className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
                style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
              >
                {t("settings:developer.cancel")}
              </button>
              <button
                onClick={() => handleDeveloperModeConfirm(true)}
                className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
                style={{
                  background: "var(--accent)",
                  color: "#0d1117",
                  boxShadow: "0 0 16px rgba(232,160,69,0.25)",
                }}
              >
                {t("settings:developer.activate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
          >
            <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("settings:password.title")}
            </h3>
            <div className="space-y-4">
              {passwordError && (
                <div
                  className="px-4 py-3 rounded"
                  style={{
                    background: "rgba(248,81,73,0.1)",
                    border: "1px solid rgba(248,81,73,0.3)",
                    color: "var(--danger)",
                  }}
                >
                  {passwordError}
                </div>
              )}
              <div>
                <label className="label">{t("settings:password.oldPassword")}</label>
                <input
                  type="password"
                  value={passwordForm.oldPassword}
                  onChange={(e) =>
                    setPasswordForm({ ...passwordForm, oldPassword: e.target.value })
                  }
                  className="input"
                  placeholder={t("settings:password.oldPassword")}
                  disabled={changingPassword}
                />
              </div>
              <div>
                <label className="label">{t("settings:password.newPassword")}</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) =>
                    setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                  }
                  className="input"
                  placeholder={t("settings:password.newPassword")}
                  disabled={changingPassword}
                />
              </div>
              <div>
                <label className="label">{t("settings:password.confirmPassword")}</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) =>
                    setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
                  }
                  className="input"
                  placeholder={t("settings:password.confirmPassword")}
                  disabled={changingPassword}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordError("");
                  setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
                }}
                className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
                style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
                disabled={changingPassword}
              >
                {t("common:buttons.cancel")}
              </button>
              <button
                onClick={handlePasswordChange}
                className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "var(--accent)",
                  color: "#0d1117",
                  boxShadow: "0 0 16px rgba(232,160,69,0.25)",
                }}
                disabled={changingPassword}
              >
                {changingPassword ? t("settings:password.changing") : t("settings:password.submit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
