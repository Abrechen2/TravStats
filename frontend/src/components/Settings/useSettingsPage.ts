import { useState, useEffect, useRef } from "react";
import { useSettingsStore, snapshotOf } from "../../store/settingsStore";
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
    cruise,
    baseCurrency,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setCruise,
    setBaseCurrency,
    saveRemoteSettings,
    hasPendingChanges,
  } = useSettingsStore();

  // Serialization of exactly the slices the save path transmits. Used as the
  // auto-save effect's dependency so no slice can be silently left unwatched —
  // see the comment on `snapshotOf` and issue #198.
  const saveSnapshot = useSettingsStore(snapshotOf);

  const addToast = useToastStore((state) => state.addToast);

  /** What the auto-save banner is allowed to claim right now. */
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Profile
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingProfilePicture, setUploadingProfilePicture] = useState(false);
  const [removingProfilePicture, setRemovingProfilePicture] = useState(false);

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

  // Debounced auto-save for the settings the UI presents as auto-saving.
  //
  // The dependency is `saveSnapshot` — the serialization of exactly the slices
  // `saveRemoteSettings` transmits — and NOT a hand-written list of slices.
  // That list is what issue #198 was: it named `units` and `profile` while the
  // save path sent seven slices, so editing a flight default, a display option,
  // a feature toggle or a notification updated the store and scheduled no write.
  // The page kept claiming "auto-saved" and the value died on the next reload.
  // Deriving the dependency from the payload's own definition means a slice
  // added to the save path is watched the moment it is added.
  //
  // The mount run is skipped deliberately. Mounting the page is not an edit,
  // and firing a save on the first render PUT whatever the store happened to
  // hold at that instant — `{ birthdate: null }` while the real value was still
  // in flight from `loadRemoteSettings`, overwriting a stored date with null
  // (issue #186).
  //
  // `remoteSnapshot` covers the second half of that: hydration changes the
  // store and would otherwise re-trigger this effect and echo the server's own
  // values straight back at it on every page load.
  const isInitialSave = useRef(true);
  useEffect(() => {
    if (isInitialSave.current) {
      isInitialSave.current = false;
      return;
    }
    if (!hasPendingChanges()) return;
    const saveSettings = async () => {
      // Re-check at FIRE time, not just schedule time. Hydration
      // (`loadRemoteSettings`) mutates the settings slices and updates the
      // `remoteSnapshot` baseline in separate `set()` calls; a save scheduled
      // in the transient window between them must not actually run once the
      // baseline has caught up. React 18 happened to clear this timeout via a
      // follow-up re-render; React 19's effect timing does not, which re-exposed
      // the issue-#186 hydration echo. A genuine edit still differs from the
      // (now-settled) snapshot, so it still saves.
      if (!hasPendingChanges()) {
        setAutoSaveState("idle");
        return;
      }
      setAutoSaveState("saving");
      try {
        await saveRemoteSettings();
        setAutoSaveState("saved");
      } catch (error) {
        logger.error("Failed to save settings:", error);
        setAutoSaveState("idle");
        addToast("error", t("settings:errors.saveFailed") || "Failed to save settings");
      }
    };
    const timeoutId = setTimeout(saveSettings, 500);
    return () => clearTimeout(timeoutId);
    // `t` and `addToast` are intentionally omitted: `t` is unstable across
    // renders and would re-fire this effect on every render, which before the
    // debounce was tripping the settings rate limit.
  }, [saveSnapshot, saveRemoteSettings, hasPendingChanges]);

  // The "saved" confirmation is transient — it states that a write just landed,
  // not that the page is generally auto-saving. Issue #198 also reported the
  // banner as permanently green with a checkmark, which is why the loss of a
  // flight default looked like a success.
  useEffect(() => {
    if (autoSaveState !== "saved") return;
    const timeoutId = setTimeout(() => setAutoSaveState("idle"), 2500);
    return () => clearTimeout(timeoutId);
  }, [autoSaveState]);

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
      // Do NOT fall back to a `URL.createObjectURL(file)` blob: that blob
      // dies on reload (and the backend rejects it anyway — see #186), so
      // showing it here just hides the real failure from the user. Leave
      // the previous avatar in place and surface the error instead.
      logger.error("Failed to upload profile picture:", error);
      const axiosError = error as { response?: { data?: { error?: string } } };
      addToast("error", axiosError.response?.data?.error || t("settings:profile.uploadError"));
    } finally {
      setUploadingProfilePicture(false);
      if (event.target) event.target.value = "";
    }
  };

  const handleAvatarDelete = async () => {
    setRemovingProfilePicture(true);
    try {
      await settingsApi.deleteProfilePicture();
      // `undefined`, not `null`: the auto-save serializes the profile slice,
      // and an omitted key can never re-fail the general PUT's URL validation.
      setProfile({ profilePicture: undefined });
      addToast("success", t("settings:profile.removeSuccess"));
    } catch (error: unknown) {
      logger.error("Failed to remove profile picture:", error);
      const axiosError = error as { response?: { data?: { error?: string } } };
      addToast("error", axiosError.response?.data?.error || t("settings:profile.removeError"));
    } finally {
      setRemovingProfilePicture(false);
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
    cruise,
    baseCurrency,
    autoSaveState,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setCruise,
    setBaseCurrency,
    // Derived
    hasParserAccess,
    // Profile
    savingProfile,
    uploadingProfilePicture,
    removingProfilePicture,
    saveProfileSettings,
    handleAvatarUpload,
    handleAvatarDelete,
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
