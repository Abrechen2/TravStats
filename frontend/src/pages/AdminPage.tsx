import { useState, useEffect } from 'react';
import { useToastStore } from '../store/toastStore';
import { adminApi } from '../lib/api';
import axios from 'axios';
import { logger } from '../lib/logger';
import NavigationBar from '../components/NavigationBar';
import BackupManagement from '../components/Admin/BackupManagement';
import SystemInfoTab from '../components/Admin/SystemInfo';
import UserManagement from '../components/Admin/UserManagement';
import InvitationManagement from '../components/Admin/InvitationManagement';
import GlobalApiKeysManager from '../components/Admin/GlobalApiKeysManager';
import ParserSettingsTab from '../components/Admin/ParserSettings';
import TrainingConfigTab from '../components/Admin/TrainingConfig';
import LoggingManager from '../components/Admin/LoggingManager';
import FeedbackAnalytics from '../components/Admin/FeedbackAnalytics';
import PatternManagement from '../components/Admin/PatternManagement';
import { useTranslation } from '../hooks/useTranslation';

import type { SystemInfoData, HardwareInfo, AdminUser } from '../components/Admin/SystemInfo';
import type { Invitation } from '../components/Admin/InvitationManagement';
import type { GlobalApiKeys, ParserApiKeySettings } from '../components/Admin/GlobalApiKeysManager';
import type { ParserSettingsData } from '../components/Admin/ParserSettings';
import type { TrainingConfigData } from '../components/Admin/TrainingConfig';
import type { LoggingConfig, LogFile, LogStats } from '../components/Admin/LoggingManager';
import type { FeedbackStats, FeedbackDetails } from '../components/Admin/FeedbackAnalytics';
import type { PatternData } from '../components/Admin/PatternManagement';

// ==================== Helpers ====================

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    return error.response?.data?.error || error.response?.data?.message || fallback;
  }
  return fallback;
}

type ActiveTab = 'users' | 'invitations' | 'system' | 'parsers' | 'training' | 'logging' | 'feedback' | 'patterns' | 'backups' | 'apiKeys';

// ==================== Admin Page Component ====================

export default function AdminPage(): JSX.Element {
  const { t } = useTranslation(['admin', 'common']);
  const addToast = useToastStore((state) => state.addToast);

  // State
  const [systemInfo, setSystemInfo] = useState<SystemInfoData | null>(null);
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [parserSettings, setParserSettings] = useState<ParserSettingsData | null>(null);
  const [loggingConfig, setLoggingConfig] = useState<LoggingConfig | null>(null);
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [patternData, setPatternData] = useState<PatternData | null>(null);
  const [feedbackDetails, setFeedbackDetails] = useState<FeedbackDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHardwareInfo, setLoadingHardwareInfo] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('system');
  const [trainingConfig, setTrainingConfig] = useState<TrainingConfigData | null>(null);
  const [savingTrainingConfig, setSavingTrainingConfig] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [savingParsers, setSavingParsers] = useState(false);
  const [savingLogging, setSavingLogging] = useState(false);
  const [feedbackDays, setFeedbackDays] = useState(30);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [showPatternConfirm, setShowPatternConfirm] = useState<string | null>(null);
  const [showAutoApplyConfirm, setShowAutoApplyConfirm] = useState(false);
  const [globalApiKeys, setGlobalApiKeys] = useState<GlobalApiKeys | null>(null);
  const [savingGlobalApiKeys, setSavingGlobalApiKeys] = useState(false);

  // ==================== Data Loading ====================

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'system') {
      loadHardwareInfo();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'logging') {
      loadLoggingData();
    } else if (activeTab === 'feedback') {
      loadFeedbackData();
    } else if (activeTab === 'patterns') {
      loadPatternData();
    } else if (activeTab === 'system') {
      loadHardwareInfo();
    } else if (activeTab === 'apiKeys') {
      if (!globalApiKeys) {
        loadGlobalApiKeys();
      }
      if (!parserSettings) {
        loadData();
      }
    } else if (activeTab === 'training') {
      loadTrainingConfig();
    }
  }, [activeTab, feedbackDays]);

  const loadData = async (): Promise<void> => {
    setLoading(true);
    try {
      const [infoData, usersData, invitationsData, parserData, trainingData] = await Promise.all([
        adminApi.getSystemInfo(),
        adminApi.getUsers(),
        adminApi.getInvitations(),
        adminApi.getAdminParserSettings(),
        adminApi.getTrainingConfig().catch(() => null),
      ]);
      setSystemInfo(infoData as SystemInfoData);
      setUsers(usersData.users);
      setInvitations(invitationsData.invitations);
      setParserSettings(parserData);
      if (trainingData) {
        setTrainingConfig(trainingData);
      }
    } catch (error) {
      logger.error('Failed to load admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadGlobalApiKeys = async (): Promise<void> => {
    try {
      const data = await adminApi.getGlobalApiKeys();
      setGlobalApiKeys(data);
    } catch (error) {
      logger.error('Failed to load global API keys:', error);
    }
  };

  const loadTrainingConfig = async (): Promise<void> => {
    try {
      const data = await adminApi.getTrainingConfig();
      setTrainingConfig(data);
    } catch (error) {
      logger.error('Failed to load training config:', error);
    }
  };

  const loadLoggingData = async (): Promise<void> => {
    try {
      const [configData, filesData, statsData] = await Promise.all([
        adminApi.getLoggingConfig(),
        adminApi.getLogFiles(),
        adminApi.getLogStats(),
      ]);
      setLoggingConfig(configData);
      setLogFiles(filesData.files);
      setLogStats(statsData);
    } catch (error) {
      logger.error('Failed to load logging data:', error);
    }
  };

  const loadFeedbackData = async (): Promise<void> => {
    try {
      const [stats, details] = await Promise.all([
        adminApi.getParserFeedbackStats({ days: feedbackDays }),
        adminApi.getParserFeedbackDetails({ days: feedbackDays, limit: 100 }),
      ]);
      setFeedbackStats(stats);
      setFeedbackDetails(details);
    } catch (error) {
      logger.error('Failed to load feedback data:', error);
    }
  };

  const loadPatternData = async (): Promise<void> => {
    try {
      const data = await adminApi.getParserPatterns({ days: feedbackDays });
      setPatternData(data as PatternData);
    } catch (error) {
      logger.error('Failed to load pattern data:', error);
    }
  };

  const loadHardwareInfo = async (): Promise<void> => {
    if (loadingHardwareInfo) {
      return;
    }
    setLoadingHardwareInfo(true);
    try {
      logger.debug('Loading hardware info...');
      const data = await adminApi.getHardwareInfo();
      logger.debug('Hardware info loaded:', data);
      setHardwareInfo(data);
    } catch (error) {
      logger.error('Failed to load hardware info:', error);
      setHardwareInfo({
        error: error instanceof Error ? error.message : 'Failed to load hardware information',
        cpu: { cores: 0, model: 'Unknown', architecture: 'Unknown' },
        gpu: { available: false, error: 'Failed to load' },
        python: { available: false, error: 'Failed to load' },
        docker: false,
        trainingAccess: { accessible: false, error: 'Failed to load' },
      });
    } finally {
      setLoadingHardwareInfo(false);
    }
  };

  // ==================== Handlers ====================

  const handleToggleUserActive = async (userId: string): Promise<void> => {
    try {
      await adminApi.toggleUserActive(userId);
      addToast('success', t('admin:toasts.userUpdated'));
      await loadData();
    } catch (error: unknown) {
      addToast('error', getErrorMessage(error, t('admin:toasts.userUpdateFailed')));
    }
  };

  const handleCreateInvitation = async (): Promise<void> => {
    const email = prompt(t('admin:prompts.enterEmail'));
    try {
      const { inviteUrl } = await adminApi.createInvitation(email || undefined, 7);
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 3000);
      addToast('success', t('admin:toasts.invitationCopied', { inviteUrl }));
      await loadData();
    } catch (error: unknown) {
      addToast('error', getErrorMessage(error, t('admin:toasts.invitationFailed')));
    }
  };

  const handleExportData = async (): Promise<void> => {
    if (!confirm(t('admin:prompts.confirmExport'))) {
      return;
    }
    try {
      const data = await adminApi.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `travstats-backup-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      addToast('error', getErrorMessage(error, t('admin:toasts.exportFailed')));
    }
  };

  const handleSaveGlobalApiKeys = async (): Promise<void> => {
    setSavingGlobalApiKeys(true);
    setSavingParsers(true);
    try {
      await Promise.all([
        adminApi.updateGlobalApiKeys(globalApiKeys || {}),
        adminApi.updateAdminParserSettings({
          globalOpenaiApiKey: parserSettings?.globalOpenaiApiKey,
          globalClaudeApiKey: parserSettings?.globalClaudeApiKey,
          allowUserApiKeys: parserSettings?.allowUserApiKeys,
          requireUserApiKeys: parserSettings?.requireUserApiKeys,
        }),
      ]);
      addToast('success', t('admin:globalApiKeys.saved') || 'API keys saved successfully');
      await loadGlobalApiKeys();
      if (parserSettings) {
        const parserData = await adminApi.getAdminParserSettings();
        setParserSettings(parserData);
      }
    } catch (error: unknown) {
      logger.error('Failed to save API keys:', error);
      addToast('error', getErrorMessage(error, t('admin:globalApiKeys.saveFailed') || 'Failed to save API keys'));
    } finally {
      setSavingGlobalApiKeys(false);
      setSavingParsers(false);
    }
  };

  const handleSaveParserSettings = async (): Promise<void> => {
    if (!parserSettings) return;
    setSavingParsers(true);
    try {
      await adminApi.updateAdminParserSettings(parserSettings);
      addToast('success', t('admin:toasts.parserSettingsSaved'));
    } catch (error: unknown) {
      logger.error('Failed to save parser settings:', error);
      addToast('error', getErrorMessage(error, t('admin:toasts.parserSettingsFailed')));
    } finally {
      setSavingParsers(false);
    }
  };

  const handleSaveTrainingConfig = async (): Promise<void> => {
    if (!trainingConfig) return;
    setSavingTrainingConfig(true);
    try {
      await adminApi.updateTrainingConfig({
        trainingModelOutputDir: trainingConfig.trainingModelOutputDir || null,
        trainingEmailModelName: trainingConfig.trainingEmailModelName || null,
        trainingVisionModelName: trainingConfig.trainingVisionModelName || null,
      });
      addToast('success', t('admin:toasts.trainingConfigSaved'));
      await loadTrainingConfig();
    } catch (error: unknown) {
      logger.error('Failed to save training config:', error);
      addToast('error', getErrorMessage(error, t('admin:toasts.trainingConfigFailed')));
    } finally {
      setSavingTrainingConfig(false);
    }
  };

  const handleToggleDebugLogging = async (): Promise<void> => {
    if (!loggingConfig) return;
    const newState = loggingConfig.logLevel !== 'debug';
    try {
      await adminApi.toggleDebugLogging(newState);
      await loadLoggingData();
      addToast('success', t('admin:toasts.debugLoggingToggled', {
        state: newState ? t('admin:toasts.enabled') : t('admin:toasts.disabled'),
      }));
    } catch (error: unknown) {
      logger.error('Failed to toggle debug logging:', error);
      addToast('error', getErrorMessage(error, t('admin:toasts.debugLoggingFailed')));
    }
  };

  const handleSaveLoggingConfig = async (): Promise<void> => {
    if (!loggingConfig) return;
    setSavingLogging(true);
    try {
      await adminApi.updateLoggingConfig(loggingConfig);
      addToast('success', t('admin:toasts.loggingConfigSaved'));
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error('Failed to save logging config:', error);
      addToast('error', getErrorMessage(error, t('admin:toasts.loggingConfigFailed')));
    } finally {
      setSavingLogging(false);
    }
  };

  const handleDownloadLogFile = async (filename: string): Promise<void> => {
    try {
      const blob = await adminApi.downloadLogFile(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      logger.error('Failed to download log file:', error);
      addToast('error', getErrorMessage(error, t('admin:toasts.logFileDownloadFailed')));
    }
  };

  const handleDeleteLogFile = async (filename: string): Promise<void> => {
    if (!confirm(t('admin:prompts.confirmDeleteLog', { filename }))) {
      return;
    }
    try {
      await adminApi.deleteLogFile(filename);
      addToast('success', t('admin:toasts.logFileDeleted'));
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error('Failed to delete log file:', error);
      addToast('error', getErrorMessage(error, t('admin:toasts.logFileDeletFailed')));
    }
  };

  const handleCleanupLogs = async (): Promise<void> => {
    if (!confirm(t('admin:prompts.confirmCleanupLogs'))) {
      return;
    }
    try {
      const result = await adminApi.cleanupLogs();
      addToast('success', t('admin:toasts.cleanupComplete', {
        filesDeleted: result.filesDeleted,
        spaceFreed: (result.spaceFreed / 1024 / 1024).toFixed(2),
      }));
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error('Failed to cleanup logs:', error);
      addToast('error', getErrorMessage(error, t('admin:toasts.cleanupFailed')));
    }
  };

  const handleApplyPattern = async (eventId: string): Promise<void> => {
    setShowPatternConfirm(eventId);
  };

  const handleApplyPatternConfirm = async (): Promise<void> => {
    if (!showPatternConfirm) return;
    const eventId = showPatternConfirm;
    setShowPatternConfirm(null);
    try {
      const result = await adminApi.applyPatternSuggestion(eventId, false);
      addToast('success', result.message);
      await loadPatternData();
    } catch (error: unknown) {
      addToast('error', getErrorMessage(error, t('admin:toasts.patternApplyError')));
    }
  };

  const handleAutoApplyPatterns = async (): Promise<void> => {
    setShowAutoApplyConfirm(true);
  };

  const handleAutoApplyPatternsConfirm = async (): Promise<void> => {
    setShowAutoApplyConfirm(false);
    try {
      const result = await adminApi.autoApplyPatterns(0.9);
      addToast('success', result.message);
      await loadPatternData();
    } catch (error: unknown) {
      addToast('error', getErrorMessage(error, t('admin:toasts.autoApplyError')));
    }
  };

  // ==================== Render ====================

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <NavigationBar />
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          Admin Panel
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <NavigationBar />
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t('admin:title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t('admin:description')}
          </p>
        </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('system')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'system'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          System Info
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'users'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Users ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('invitations')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'invitations'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin:tabs.invitations')}
        </button>
        <button
          onClick={() => setActiveTab('apiKeys')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'apiKeys'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin:tabs.apiKeys')}
        </button>
        <button
          onClick={() => setActiveTab('parsers')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'parsers'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin:tabs.parsers')}
        </button>
        <button
          onClick={() => setActiveTab('training')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'training'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin:tabs.training')}
        </button>
        <button
          onClick={() => setActiveTab('logging')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'logging'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin:tabs.logging')}
        </button>
        <button
          onClick={() => setActiveTab('feedback')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'feedback'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin:parserFeedback')}
          {feedbackStats && feedbackStats.total > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
              {feedbackStats.total}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('patterns')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'patterns'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin:patternUpdates')}
          {patternData && patternData.pendingSuggestions && patternData.pendingSuggestions.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full">
              {patternData.pendingSuggestions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('backups')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'backups'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin:tabs.backups')}
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'system' && systemInfo && (
        <SystemInfoTab
          systemInfo={systemInfo}
          hardwareInfo={hardwareInfo}
          loadingHardwareInfo={loadingHardwareInfo}
          users={users}
          onLoadHardwareInfo={loadHardwareInfo}
          onExportData={handleExportData}
          onToggleDemoUser={handleToggleUserActive}
        />
      )}

      {activeTab === 'users' && (
        <UserManagement
          users={users}
          onToggleUserActive={handleToggleUserActive}
        />
      )}

      {activeTab === 'invitations' && (
        <InvitationManagement
          invitations={invitations}
          copiedUrl={copiedUrl}
          onCreateInvitation={handleCreateInvitation}
        />
      )}

      {activeTab === 'apiKeys' && (
        <GlobalApiKeysManager
          globalApiKeys={globalApiKeys}
          parserSettings={parserSettings ? {
            globalOpenaiApiKey: parserSettings.globalOpenaiApiKey,
            globalClaudeApiKey: parserSettings.globalClaudeApiKey,
            allowUserApiKeys: parserSettings.allowUserApiKeys,
            requireUserApiKeys: parserSettings.requireUserApiKeys,
          } : null}
          saving={savingGlobalApiKeys || savingParsers}
          onSave={handleSaveGlobalApiKeys}
          onGlobalApiKeysChange={setGlobalApiKeys}
          onParserSettingsChange={(apiKeySettings: ParserApiKeySettings) => {
            if (parserSettings) {
              setParserSettings({
                ...parserSettings,
                globalOpenaiApiKey: apiKeySettings.globalOpenaiApiKey,
                globalClaudeApiKey: apiKeySettings.globalClaudeApiKey,
                allowUserApiKeys: apiKeySettings.allowUserApiKeys,
                requireUserApiKeys: apiKeySettings.requireUserApiKeys,
              });
            }
          }}
        />
      )}

      {activeTab === 'parsers' && parserSettings && (
        <ParserSettingsTab
          parserSettings={parserSettings}
          savingParsers={savingParsers}
          onSave={handleSaveParserSettings}
          onParserSettingsChange={setParserSettings}
        />
      )}

      {activeTab === 'training' && trainingConfig && (
        <TrainingConfigTab
          trainingConfig={trainingConfig}
          savingTrainingConfig={savingTrainingConfig}
          onSave={handleSaveTrainingConfig}
          onTrainingConfigChange={setTrainingConfig}
        />
      )}

      {activeTab === 'logging' && loggingConfig && (
        <LoggingManager
          loggingConfig={loggingConfig}
          logFiles={logFiles}
          logStats={logStats}
          savingLogging={savingLogging}
          onSave={handleSaveLoggingConfig}
          onToggleDebug={handleToggleDebugLogging}
          onDownload={handleDownloadLogFile}
          onDelete={handleDeleteLogFile}
          onCleanup={handleCleanupLogs}
          onLoggingConfigChange={setLoggingConfig}
        />
      )}

      {activeTab === 'feedback' && (
        <FeedbackAnalytics
          feedbackStats={feedbackStats}
          feedbackDetails={feedbackDetails}
          feedbackDays={feedbackDays}
          selectedFeedbackId={selectedFeedbackId}
          onSetDays={setFeedbackDays}
          onSelectFeedback={setSelectedFeedbackId}
        />
      )}

      {activeTab === 'patterns' && (
        <PatternManagement
          patternData={patternData}
          feedbackDays={feedbackDays}
          showPatternConfirm={showPatternConfirm}
          showAutoApplyConfirm={showAutoApplyConfirm}
          onSetDays={setFeedbackDays}
          onApply={handleApplyPattern}
          onApplyConfirm={handleApplyPatternConfirm}
          onAutoApply={handleAutoApplyPatterns}
          onAutoApplyConfirm={handleAutoApplyPatternsConfirm}
          onDismissConfirm={() => setShowPatternConfirm(null)}
          onDismissAutoApply={() => setShowAutoApplyConfirm(false)}
        />
      )}

      {activeTab === 'backups' && (
        <BackupManagement />
      )}

      </div>
    </div>
  );
}
