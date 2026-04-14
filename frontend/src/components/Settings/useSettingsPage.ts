import { useState, useEffect } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { useThemeStore } from "../../store/themeStore";
import { useAuthStore } from "../../store/authStore";
import { settingsApi, authApi, backupApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

interface AutoUpdateSettings {
  enabled: boolean;
  requireApproval: boolean;
  checkInterval: number;
  onlyDuringFlight: boolean;
  expiryHours: number;
}

interface HistoricalEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

interface ApiKeysFormState {
  airlabsApiKey: string;
  aviationstackApiKey: string;
  openskyClientId: string;
  openskyClientSecret: string;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSettingsPage() {
  const { t } = useTranslation(["settings", "common"]);
  const { user } = useAuthStore();
  const {
    profile,
    display,
    units,
    defaults,
    map,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    saveRemoteSettings,
  } = useSettingsStore();

  const { isDarkMode, setDarkMode } = useThemeStore();
  const addToast = useToastStore((state) => state.addToast);

  // Developer mode
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [showDeveloperConfirm, setShowDeveloperConfirm] = useState(false);
  const [loadingDeveloperMode, setLoadingDeveloperMode] = useState(false);

  // Profile
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingProfilePicture, setUploadingProfilePicture] = useState(false);

  // Password modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState("");

  // Backup
  const [lastBackup, setLastBackup] = useState<{
    completedAt: string | null;
    size: string;
    status: string;
  } | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ running: boolean } | null>(null);

  // Auto-update
  const [autoUpdateSettings, setAutoUpdateSettings] = useState<AutoUpdateSettings>({
    enabled: false,
    requireApproval: true,
    checkInterval: 15,
    onlyDuringFlight: true,
    expiryHours: 24,
  });
  const [loadingAutoUpdateSettings, setLoadingAutoUpdateSettings] = useState(false);

  // Enrichment
  const [historicalEnrichmentSettings, setHistoricalEnrichmentSettings] =
    useState<HistoricalEnrichmentSettings>({
      enabled: false,
      minConfidence: 60,
      maxPerDay: 50,
    });
  const [loadingHistoricalEnrichmentSettings, setLoadingHistoricalEnrichmentSettings] =
    useState(false);

  // API keys
  const [apiKeysStatus, setApiKeysStatus] = useState<{
    airlabs: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    aviationstack: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeysFormState>({
    airlabsApiKey: "",
    aviationstackApiKey: "",
    openskyClientId: "",
    openskyClientSecret: "",
  });
  const [loadingApiKeys, setLoadingApiKeys] = useState(false);

  const hasParserAccess = user?.isAdmin ?? false;

  // ---- Effects ---------------------------------------------------------------

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await settingsApi.get();
        logger.info("Loaded settings from server:", settings);
        setAutoUpdateSettings({
          enabled: settings.autoUpdate?.enabled ?? false,
          requireApproval: settings.autoUpdate?.requireApproval ?? true,
          checkInterval: settings.autoUpdate?.checkInterval ?? 15,
          onlyDuringFlight: settings.autoUpdate?.onlyDuringFlight ?? true,
          expiryHours: settings.autoUpdate?.expiryHours ?? 24,
        });
        setHistoricalEnrichmentSettings({
          enabled: settings.historicalEnrichment?.enabled ?? false,
          minConfidence: settings.historicalEnrichment?.minConfidence ?? 60,
          maxPerDay: settings.historicalEnrichment?.maxPerDay ?? 50,
        });
      } catch (error) {
        logger.error("Failed to load settings:", error);
      }
    };
    loadSettings();

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

  useEffect(() => {
    const saveSettings = async () => {
      try {
        await saveRemoteSettings();
      } catch (error) {
        logger.error("Failed to save units settings:", error);
        addToast("error", t("settings:errors.saveFailed") || "Failed to save settings");
      }
    };
    const timeoutId = setTimeout(saveSettings, 500);
    return () => clearTimeout(timeoutId);
  }, [units, saveRemoteSettings, addToast, t]);

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
      const interval = setInterval(loadBackupInfo, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  useEffect(() => {
    if (hasParserAccess) {
      settingsApi
        .getDeveloperMode()
        .then((data) => {
          setDeveloperModeEnabled(data.enabled);
        })
        .catch((error: unknown) => {
          const axiosError = error as { response?: { status?: number } };
          if (axiosError.response?.status === 403 || axiosError.response?.status === 401) {
            logger.warn("Training access denied or not available:", error);
            setDeveloperModeEnabled(false);
          } else {
            logger.error("Failed to load developer mode status:", error);
          }
        });
    } else {
      setDeveloperModeEnabled(false);
    }
  }, [hasParserAccess]);

  // ---- Handlers --------------------------------------------------------------

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      addToast("error", t("settings:profile.invalidFileType"));
      return;
    }
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
      const url = URL.createObjectURL(file);
      setProfile({ profilePicture: url });
    } finally {
      setUploadingProfilePicture(false);
      if (event.target) event.target.value = "";
    }
  };

  const handleThemeToggle = () => {
    const nextIsDark = !isDarkMode;
    setDarkMode(nextIsDark);
    setDisplay({ theme: nextIsDark ? "dark" : "light" });
  };

  const handleDeveloperModeToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.checked) {
      handleDeveloperModeConfirm(false);
    } else {
      setShowDeveloperConfirm(true);
    }
  };

  const handleDeveloperModeConfirm = async (enabled: boolean) => {
    setLoadingDeveloperMode(true);
    setShowDeveloperConfirm(false);
    try {
      await settingsApi.updateDeveloperMode({ enabled, confirmed: enabled });
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
      setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error: unknown) {
      logger.error("Failed to change password:", error);
      const axiosError = error as { response?: { data?: { error?: string } } };
      setPasswordError(axiosError.response?.data?.error || t("settings:password.error"));
    } finally {
      setChangingPassword(false);
    }
  };

  const saveProfileSettings = async () => {
    try {
      setSavingProfile(true);
      await saveRemoteSettings();
      addToast("success", t("settings:profile.saved") || "Profil gespeichert");
    } catch (error) {
      logger.error("Failed to save profile settings:", error);
      addToast("error", t("settings:profile.saveFailed") || "Fehler beim Speichern des Profils");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveAutoUpdateSettings = async () => {
    try {
      setLoadingAutoUpdateSettings(true);
      await settingsApi.update({ autoUpdate: autoUpdateSettings });
      const reloaded = await settingsApi.get();
      if (reloaded.autoUpdate) setAutoUpdateSettings(reloaded.autoUpdate);
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

  const saveHistoricalEnrichmentSettings = async () => {
    try {
      setLoadingHistoricalEnrichmentSettings(true);
      await settingsApi.update({ historicalEnrichment: historicalEnrichmentSettings });
      const reloaded = await settingsApi.get();
      if (reloaded.historicalEnrichment) {
        setHistoricalEnrichmentSettings(reloaded.historicalEnrichment);
      }
      addToast("success", t("settings:historicalEnrichment.saved") || "Einstellungen gespeichert");
    } catch (error) {
      logger.error("Failed to save historical enrichment settings:", error);
      addToast("error", t("settings:historicalEnrichment.saveFailed") || "Fehler beim Speichern");
    } finally {
      setLoadingHistoricalEnrichmentSettings(false);
    }
  };

  const saveApiKeys = async () => {
    setLoadingApiKeys(true);
    try {
      await settingsApi.updateApiKeys(apiKeys);
      addToast("success", t("settings:apiKeys.saved") || "API keys saved successfully");
      const status = await settingsApi.getApiKeys();
      setApiKeysStatus(status);
      setApiKeys({
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
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPasswordError("");
    setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
  };

  return {
    // Store state
    user,
    profile,
    display,
    units,
    defaults,
    map,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    isDarkMode,
    // Derived
    hasParserAccess,
    // Developer mode
    developerModeEnabled,
    showDeveloperConfirm,
    setShowDeveloperConfirm,
    loadingDeveloperMode,
    handleDeveloperModeToggle,
    handleDeveloperModeConfirm,
    // Profile
    savingProfile,
    uploadingProfilePicture,
    saveProfileSettings,
    handleAvatarUpload,
    handleThemeToggle,
    // Password modal
    showPasswordModal,
    setShowPasswordModal,
    changingPassword,
    passwordForm,
    setPasswordForm,
    passwordError,
    handlePasswordChange,
    closePasswordModal,
    // Backup
    lastBackup,
    backupStatus,
    // Auto-update
    autoUpdateSettings,
    setAutoUpdateSettings,
    loadingAutoUpdateSettings,
    saveAutoUpdateSettings,
    // Enrichment
    historicalEnrichmentSettings,
    setHistoricalEnrichmentSettings,
    loadingHistoricalEnrichmentSettings,
    saveHistoricalEnrichmentSettings,
    // API keys
    apiKeysStatus,
    apiKeys,
    setApiKeys,
    loadingApiKeys,
    saveApiKeys,
  };
}
