import { useState, useEffect } from "react";
import { useSettingsStore } from "../../store/settingsStore";
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
  aerodataboxApiKey: string;
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
    cruise,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    setCruise,
    saveRemoteSettings,
  } = useSettingsStore();

  const addToast = useToastStore((state) => state.addToast);

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
    aerodatabox: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeysFormState>({
    airlabsApiKey: "",
    aviationstackApiKey: "",
    aerodataboxApiKey: "",
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
    // `t` and `addToast` are intentionally omitted: `t` is unstable across
    // renders and would cause this effect to re-fire on every render, which
    // before debounce was tripping the settings rate limit. We only want to
    // save when `units` actually changes.
  }, [units, saveRemoteSettings]);

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

  const handlePasswordChange = async () => {
    setPasswordError("");
    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError(t("settings:password.required"));
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setPasswordError(t("settings:password.tooShort"));
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError(t("settings:password.mismatch"));
      return;
    }
    if (passwordForm.oldPassword === passwordForm.newPassword) {
      setPasswordError(t("settings:password.sameAsOld"));
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
        aerodataboxApiKey: "",
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
    cruise,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    setCruise,
    // Derived
    hasParserAccess,
    // Profile
    savingProfile,
    uploadingProfilePicture,
    saveProfileSettings,
    handleAvatarUpload,
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
