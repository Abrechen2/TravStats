import { useState, useEffect } from 'react';
import { useToastStore } from '../store/toastStore';
import { adminApi } from '../lib/api';
import { format } from 'date-fns';
import { logger } from '../lib/logger';
import InlineHelp from '../components/Help/InlineHelp';
import BackupManagement from '../components/Admin/BackupManagement';
import { useTranslation } from '../hooks/useTranslation';

export default function AdminPage() {
  const { t } = useTranslation(['admin', 'common']);
  const addToast = useToastStore((state) => state.addToast);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [hardwareInfo, setHardwareInfo] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [parserSettings, setParserSettings] = useState<any>(null);
  const [loggingConfig, setLoggingConfig] = useState<any>(null);
  const [logFiles, setLogFiles] = useState<any[]>([]);
  const [logStats, setLogStats] = useState<any>(null);
  const [feedbackStats, setFeedbackStats] = useState<any>(null);
  const [patternData, setPatternData] = useState<any>(null);
  const [feedbackDetails, setFeedbackDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHardwareInfo, setLoadingHardwareInfo] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'invitations' | 'system' | 'parsers' | 'training' | 'logging' | 'feedback' | 'patterns' | 'backups'>('system');
  const [trainingConfig, setTrainingConfig] = useState<any>(null);
  const [savingTrainingConfig, setSavingTrainingConfig] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [savingParsers, setSavingParsers] = useState(false);
  const [savingLogging, setSavingLogging] = useState(false);
  const [feedbackDays, setFeedbackDays] = useState(30);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [showPatternConfirm, setShowPatternConfirm] = useState<string | null>(null);
  const [showAutoApplyConfirm, setShowAutoApplyConfirm] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // Load hardware info when system tab becomes active
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
    } else if (activeTab === 'training') {
      loadTrainingConfig();
    }
  }, [activeTab, feedbackDays]);

  const loadTrainingConfig = async () => {
    try {
      const data = await adminApi.getTrainingConfig();
      setTrainingConfig(data);
    } catch (error) {
      logger.error('Failed to load training config:', error);
    }
  };

  const handleSaveTrainingConfig = async () => {
    if (!trainingConfig) return;
    setSavingTrainingConfig(true);
    try {
      await adminApi.updateTrainingConfig({
        trainingModelOutputDir: trainingConfig.trainingModelOutputDir || null,
        trainingEmailModelName: trainingConfig.trainingEmailModelName || null,
        trainingVisionModelName: trainingConfig.trainingVisionModelName || null,
      });
      addToast('success', 'Training configuration saved successfully!');
      await loadTrainingConfig();
    } catch (error: any) {
      logger.error('Failed to save training config:', error);
      addToast('error', error.response?.data?.error || 'Failed to save training configuration');
    } finally {
      setSavingTrainingConfig(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [infoData, usersData, invitationsData, parserData, trainingData] = await Promise.all([
        adminApi.getSystemInfo(),
        adminApi.getUsers(),
        adminApi.getInvitations(),
        adminApi.getAdminParserSettings(),
        adminApi.getTrainingConfig().catch(() => null), // Optional, may fail if not implemented yet
      ]);
      setSystemInfo(infoData);
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

  const loadLoggingData = async () => {
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

  const loadFeedbackData = async () => {
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

  const loadPatternData = async () => {
    try {
      const data = await adminApi.getParserPatterns({ days: feedbackDays });
      setPatternData(data);
    } catch (error) {
      logger.error('Failed to load pattern data:', error);
    }
  };

  const loadHardwareInfo = async () => {
    // Prevent multiple parallel requests
    if (loadingHardwareInfo) {
      return;
    }
    
    setLoadingHardwareInfo(true);
    try {
      console.log('Loading hardware info...');
      const data = await adminApi.getHardwareInfo();
      console.log('Hardware info loaded:', data);
      setHardwareInfo(data);
    } catch (error) {
      console.error('Failed to load hardware info:', error);
      // Set hardwareInfo to object with error to show error state
      setHardwareInfo({ 
        error: error instanceof Error ? error.message : 'Failed to load hardware information',
        cpu: { cores: 0, model: 'Unknown', architecture: 'Unknown' },
        gpu: { available: false, error: 'Failed to load' },
        python: { available: false, error: 'Failed to load' },
        docker: false,
        trainingAccess: { accessible: false, error: 'Failed to load' }
      });
    } finally {
      setLoadingHardwareInfo(false);
    }
  };

  const handleApplyPattern = async (eventId: string) => {
    setShowPatternConfirm(eventId);
  };

  const handleApplyPatternConfirm = async () => {
    if (!showPatternConfirm) return;
    const eventId = showPatternConfirm;
    setShowPatternConfirm(null);
    try {
      const result = await adminApi.applyPatternSuggestion(eventId, false);
      addToast('success', result.message);
      await loadPatternData();
    } catch (error: any) {
      addToast('error', error.response?.data?.message || 'Fehler beim Anwenden des Patterns');
    }
  };

  const handleAutoApplyPatterns = async () => {
    setShowAutoApplyConfirm(true);
  };

  const handleAutoApplyPatternsConfirm = async () => {
    setShowAutoApplyConfirm(false);
    try {
      const result = await adminApi.autoApplyPatterns(0.9);
      addToast('success', result.message);
      await loadPatternData();
    } catch (error: any) {
      addToast('error', error.response?.data?.message || 'Fehler beim automatischen Anwenden');
    }
  };

  const handleToggleUserActive = async (userId: string) => {
    try {
      await adminApi.toggleUserActive(userId);
      addToast('success', 'Benutzer erfolgreich aktualisiert');
      await loadData(); // Reload
    } catch (error: any) {
      addToast('error', error.response?.data?.error || 'Failed to update user');
    }
  };

  const handleCreateInvitation = async () => {
    const email = prompt('Enter email (optional):');
    try {
      const { inviteUrl } = await adminApi.createInvitation(email || undefined, 7);
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 3000);
      addToast('success', `Invitation link copied to clipboard!\n\n${inviteUrl}`);
      await loadData(); // Reload
    } catch (error: any) {
      addToast('error', error.response?.data?.error || 'Failed to create invitation');
    }
  };

  const handleExportData = async () => {
    if (!confirm('Export all data? This will download a JSON file with all user data.')) {
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
    } catch (error: any) {
      addToast('error', error.response?.data?.error || 'Failed to export data');
    }
  };

  const handleSaveParserSettings = async () => {
    setSavingParsers(true);
    try {
      await adminApi.updateAdminParserSettings(parserSettings);
      addToast('success', 'Parser settings saved successfully!');
    } catch (error: any) {
      logger.error('Failed to save parser settings:', error);
      addToast('error', error.response?.data?.error || 'Failed to save parser settings');
    } finally {
      setSavingParsers(false);
    }
  };

  const handleToggleDebugLogging = async () => {
    if (!loggingConfig) return;
    const newState = loggingConfig.logLevel !== 'debug';
    try {
      await adminApi.toggleDebugLogging(newState);
      await loadLoggingData();
      addToast('success', `Debug logging ${newState ? 'enabled' : 'disabled'} successfully!`);
    } catch (error: any) {
      logger.error('Failed to toggle debug logging:', error);
      addToast('error', error.response?.data?.error || 'Failed to toggle debug logging');
    }
  };

  const handleSaveLoggingConfig = async () => {
    setSavingLogging(true);
    try {
      await adminApi.updateLoggingConfig(loggingConfig);
      addToast('success', 'Logging configuration saved successfully!');
      await loadLoggingData();
    } catch (error: any) {
      logger.error('Failed to save logging config:', error);
      addToast('error', error.response?.data?.error || 'Failed to save logging config');
    } finally {
      setSavingLogging(false);
    }
  };

  const handleDownloadLogFile = async (filename: string) => {
    try {
      const blob = await adminApi.downloadLogFile(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      logger.error('Failed to download log file:', error);
      addToast('error', error.response?.data?.error || 'Failed to download log file');
    }
  };

  const handleDeleteLogFile = async (filename: string) => {
    if (!confirm(`Delete log file "${filename}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await adminApi.deleteLogFile(filename);
      addToast('success', 'Log file deleted successfully!');
      await loadLoggingData();
    } catch (error: any) {
      logger.error('Failed to delete log file:', error);
      addToast('error', error.response?.data?.error || 'Failed to delete log file');
    }
  };

  const handleCleanupLogs = async () => {
    if (!confirm('Delete old log files based on retention policy? This action cannot be undone.')) {
      return;
    }
    try {
      const result = await adminApi.cleanupLogs();
      addToast('success', `Cleanup complete! Deleted ${result.filesDeleted} files, freed ${(result.spaceFreed / 1024 / 1024).toFixed(2)} MB`);
      await loadLoggingData();
    } catch (error: any) {
      logger.error('Failed to cleanup logs:', error);
      addToast('error', error.response?.data?.error || 'Failed to cleanup logs');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
          Admin Panel
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {t('admin.title')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t('admin.description')}
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
          Invitations
        </button>
        <button
          onClick={() => setActiveTab('parsers')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'parsers'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Parser Settings
        </button>
        <button
          onClick={() => setActiveTab('training')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'training'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin.trainingConfig')}
        </button>
        <button
          onClick={() => setActiveTab('logging')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'logging'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin.tabs.logging')}
        </button>
        <button
          onClick={() => setActiveTab('feedback')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'feedback'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {t('admin.parserFeedback')}
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
          {t('admin.patternUpdates')}
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
          {t('admin.tabs.backups')}
        </button>
      </div>

      {/* System Info Tab */}
      {activeTab === 'system' && systemInfo && (
        <div className="space-y-6">
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">{t('admin.instance')}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {systemInfo.instanceName}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">{t('admin.totalUsers')}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {systemInfo.userCount} / {systemInfo.maxUsers}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">{t('admin.activeUsers')}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {systemInfo.activeUserCount}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">{t('admin.totalFlights')}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {systemInfo.flightCount}
              </div>
            </div>
          </div>

          {/* Warning */}
          {systemInfo.warningThreshold && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                {t('admin.userLimitWarning.title')}
              </h3>
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                {t('admin.userLimitWarning.message', { maxUsers: systemInfo.maxUsers })}
              </p>
            </div>
          )}

          {/* Demo User Warning */}
          {systemInfo.demoUserExists && systemInfo.demoUserActive && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
              <h3 className="font-semibold text-orange-900 dark:text-orange-100 mb-2">
                🔓 Demo User Active
              </h3>
              <p className="text-sm text-orange-800 dark:text-orange-200 mb-3">
                The demo user account (username: "demo", password: "demo123") is currently active.
                This is a security risk in production environments. It is recommended to deactivate
                this account after initial testing.
              </p>
              <button
                onClick={() => {
                  const demoUser = users.find(u => u.username === 'demo');
                  if (demoUser && confirm('Deactivate the demo user account? This will prevent login with demo credentials.')) {
                    handleToggleUserActive(demoUser.id);
                  }
                }}
                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition text-sm font-medium"
              >
                Deactivate Demo User
              </button>
            </div>
          )}

          {/* Hardware Information */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Hardware Information
              </h2>
              <button
                onClick={loadHardwareInfo}
                disabled={loadingHardwareInfo}
                className="px-3 py-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingHardwareInfo ? '⏳ Lade...' : '🔄 Aktualisieren'}
              </button>
            </div>

            {!hardwareInfo && (
              <div className="text-center py-8 text-gray-600 dark:text-gray-400">
                {loadingHardwareInfo ? 'Lade Hardware-Informationen...' : 'Klicken Sie auf "Aktualisieren", um Hardware-Informationen zu laden.'}
              </div>
            )}

            {hardwareInfo && hardwareInfo.error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
                <div className="text-sm text-red-800 dark:text-red-200">
                  ⚠️ {hardwareInfo.error}
                </div>
              </div>
            )}

            {hardwareInfo && !hardwareInfo.error && (

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* CPU Info */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                    <span className="mr-2">🖥️</span> CPU
                  </h3>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-xs text-gray-500 dark:text-gray-400">Kerne</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {hardwareInfo.cpu.cores}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500 dark:text-gray-400">Modell</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white break-words">
                        {hardwareInfo.cpu.model}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500 dark:text-gray-400">Architektur</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {hardwareInfo.cpu.architecture}
                      </dd>
                    </div>
                    {hardwareInfo.cpu.error && (
                      <div className="text-xs text-red-600 dark:text-red-400">
                        ⚠️ {hardwareInfo.cpu.error}
                      </div>
                    )}
                  </dl>
                </div>

                {/* GPU Info */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                    <span className="mr-2">🎮</span> GPU
                    <span
                      className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                        hardwareInfo.gpu.available
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                          : hardwareInfo.gpu.gpuDetected
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {hardwareInfo.gpu.available
                        ? 'Verfügbar'
                        : hardwareInfo.gpu.gpuDetected
                        ? 'Erkannt (nicht verfügbar)'
                        : 'Nicht verfügbar'}
                    </span>
                  </h3>
                  {hardwareInfo.gpu.available ? (
                    <dl className="space-y-2">
                      {hardwareInfo.gpu.count && (
                        <div>
                          <dt className="text-xs text-gray-500 dark:text-gray-400">Anzahl</dt>
                          <dd className="text-sm font-medium text-gray-900 dark:text-white">
                            {hardwareInfo.gpu.count}
                          </dd>
                        </div>
                      )}
                      {hardwareInfo.gpu.gpus && hardwareInfo.gpu.gpus.length > 0 ? (
                        <div>
                          <dt className="text-xs text-gray-500 dark:text-gray-400">GPUs</dt>
                          <dd className="text-sm font-medium text-gray-900 dark:text-white">
                            {hardwareInfo.gpu.gpus.map((gpu: any) => (
                              <div key={gpu.id} className="mb-1">
                                GPU {gpu.id}: {gpu.name} ({gpu.memory} GB)
                              </div>
                            ))}
                          </dd>
                        </div>
                      ) : (
                        hardwareInfo.gpu.name && (
                          <div>
                            <dt className="text-xs text-gray-500 dark:text-gray-400">Name</dt>
                            <dd className="text-sm font-medium text-gray-900 dark:text-white break-words">
                              {hardwareInfo.gpu.name}
                            </dd>
                          </div>
                        )
                      )}
                      {hardwareInfo.gpu.memory && !hardwareInfo.gpu.gpus && (
                        <div>
                          <dt className="text-xs text-gray-500 dark:text-gray-400">Speicher</dt>
                          <dd className="text-sm font-medium text-gray-900 dark:text-white">
                            {hardwareInfo.gpu.memory} GB
                          </dd>
                        </div>
                      )}
                      {hardwareInfo.gpu.cudaVersion && (
                        <div>
                          <dt className="text-xs text-gray-500 dark:text-gray-400">CUDA Version</dt>
                          <dd className="text-sm font-medium text-gray-900 dark:text-white">
                            {hardwareInfo.gpu.cudaVersion}
                          </dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <div className="space-y-2">
                      {hardwareInfo.gpu.gpuDetected && hardwareInfo.gpu.gpuNameDetected && (
                        <div className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                          ⚠️ GPU erkannt: {hardwareInfo.gpu.gpuNameDetected}
                        </div>
                      )}
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {hardwareInfo.gpu.reason || hardwareInfo.gpu.error || 'Keine GPU erkannt'}
                      </div>
                      {hardwareInfo.gpu.diagnosis && hardwareInfo.gpu.diagnosis.length > 0 && (
                        <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
                          <div className="text-xs font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                            💡 Lösung:
                          </div>
                          <ul className="text-xs text-yellow-800 dark:text-yellow-200 space-y-1 list-disc list-inside">
                            {hardwareInfo.gpu.diagnosis.map((msg: any, idx: number) => (
                              <li key={idx}>{msg}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Python Info */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                    <span className="mr-2">🐍</span> Python
                    <span
                      className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                        hardwareInfo.python.available
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                      }`}
                    >
                      {hardwareInfo.python.available ? 'Verfügbar' : 'Nicht verfügbar'}
                    </span>
                  </h3>
                  {hardwareInfo.python.available ? (
                    <dl className="space-y-2">
                      {hardwareInfo.python.version && (
                        <div>
                          <dt className="text-xs text-gray-500 dark:text-gray-400">Version</dt>
                          <dd className="text-sm font-medium text-gray-900 dark:text-white">
                            {hardwareInfo.python.version}
                          </dd>
                        </div>
                      )}
                      {hardwareInfo.python.pytorch && (
                        <div>
                          <dt className="text-xs text-gray-500 dark:text-gray-400">PyTorch</dt>
                          <dd className="text-sm font-medium text-gray-900 dark:text-white">
                            {hardwareInfo.python.pytorch.available ? (
                              <span className="text-green-600 dark:text-green-400">
                                ✅ {hardwareInfo.python.pytorch.version || 'Verfügbar'}
                              </span>
                            ) : (
                              <span className="text-red-600 dark:text-red-400">❌ Nicht verfügbar</span>
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <div className="text-sm text-red-600 dark:text-red-400">
                      ⚠️ {hardwareInfo.python.error || 'Python nicht gefunden'}
                    </div>
                  )}
                </div>

                {/* Environment & Training Access */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                    <span className="mr-2">⚙️</span> Umgebung
                  </h3>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-xs text-gray-500 dark:text-gray-400">Docker</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {hardwareInfo.docker ? (
                          <span className="text-blue-600 dark:text-blue-400">✅ Ja</span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400">❌ Nein (Lokal)</span>
                        )}
                      </dd>
                    </div>
                    {hardwareInfo.platform && (
                      <>
                        <div>
                          <dt className="text-xs text-gray-500 dark:text-gray-400">System</dt>
                          <dd className="text-sm font-medium text-gray-900 dark:text-white">
                            {hardwareInfo.platform.system} {hardwareInfo.platform.release}
                          </dd>
                        </div>
                      </>
                    )}
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                      <dt className="text-xs text-gray-500 dark:text-gray-400 mb-1">Training Zugriff</dt>
                      <dd className="text-sm font-medium">
                        {hardwareInfo.trainingAccess.accessible ? (
                          <span className="text-green-600 dark:text-green-400">✅ Verfügbar</span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">
                            ❌ Nicht verfügbar
                            {hardwareInfo.trainingAccess.error && (
                              <div className="text-xs mt-1 text-red-500 dark:text-red-400">
                                {hardwareInfo.trainingAccess.error}
                              </div>
                            )}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            )}
          </div>

          {/* Configuration */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Configuration
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-600 dark:text-gray-400">Registration</dt>
                <dd className="text-lg font-medium text-gray-900 dark:text-white">
                  {systemInfo.registrationEnabled ? '✅ Enabled' : '❌ Disabled'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-600 dark:text-gray-400">Version</dt>
                <dd className="text-lg font-medium text-gray-900 dark:text-white">
                  {systemInfo.version}
                </dd>
              </div>
            </dl>
          </div>

          {/* Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Data Management
            </h2>
            <button
              onClick={handleExportData}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
            >
              📥 Download Full Backup (JSON)
            </button>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              Export all user data for backup purposes (GDPR compliant)
            </p>
            <InlineHelp
              title="Daten-Export"
              category="advanced"
              content={
                <div className="space-y-2 mt-2">
                  <p>
                    Exportieren Sie alle Benutzerdaten als JSON-Datei für Backup-Zwecke.
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                    <li>
                      <strong>Vollständiger Export:</strong> Enthält alle Flüge, Achievements, Einstellungen und Benutzerdaten
                    </li>
                    <li>
                      <strong>GDPR-konform:</strong> Alle Daten werden in einem strukturierten Format exportiert
                    </li>
                    <li>
                      <strong>Backup:</strong> Regelmäßige Exports werden empfohlen, um Datenverlust zu vermeiden
                    </li>
                    <li>
                      <strong>Format:</strong> JSON-Datei, die einfach importiert oder analysiert werden kann
                    </li>
                  </ul>
                </div>
              }
            />
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <InlineHelp
            title={t('admin.users.title')}
            category="advanced"
            content={
              <div className="space-y-2">
                <p>
                  Verwalten Sie alle Benutzer Ihrer TravStats-Instanz. Hier können Sie Benutzer anzeigen, Rollen ändern und Benutzer löschen.
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                  <li>
                    <strong>Admin:</strong> Vollzugriff auf alle Funktionen, einschließlich Admin-Panel
                  </li>
                  <li>
                    <strong>User:</strong> Standard-Benutzer mit Zugriff auf Flüge, Statistiken und Achievements
                  </li>
                  <li>
                    <strong>Löschen:</strong> Vorsicht! Beim Löschen werden alle Daten des Benutzers entfernt
                  </li>
                </ul>
              </div>
            }
          />
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Flights
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Achievements
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {user.username}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {format(new Date(user.createdAt), 'MMM d, yyyy')}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {user._count.flights}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {user._count.userAchievements}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.isAdmin ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                          Admin
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                          User
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.isActive ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => handleToggleUserActive(user.id)}
                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {user.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invitations Tab */}
      {activeTab === 'invitations' && (
        <div className="space-y-4">
          <InlineHelp
            title={t('admin.invitations.title')}
            category="advanced"
            content={
              <div className="space-y-2">
                <p>
                  Erstellen Sie Einladungslinks, um neue Benutzer zu Ihrer TravStats-Instanz einzuladen.
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                  <li>
                    <strong>Einladung erstellen:</strong> Generiert einen eindeutigen Link, der zum Registrieren verwendet werden kann
                  </li>
                  <li>
                    <strong>Ablaufdatum:</strong> Einladungen laufen nach 7 Tagen ab (standardmäßig)
                  </li>
                  <li>
                    <strong>Einmalige Nutzung:</strong> Jeder Link kann nur einmal verwendet werden
                  </li>
                  <li>
                    <strong>E-Mail (optional):</strong> Sie können eine E-Mail-Adresse zuordnen, um die Einladung zu verfolgen
                  </li>
                </ul>
              </div>
            }
          />
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Invitation Links
            </h2>
            <button
              onClick={handleCreateInvitation}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
            >
              + Create Invitation
            </button>
          </div>

          {copiedUrl && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-green-800 dark:text-green-200 text-sm">
              ✅ Invitation link copied to clipboard!
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Created By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Expires
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {invitation.email || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {invitation.creator.username}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {format(new Date(invitation.expiresAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {invitation.usedAt ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                          Used on {format(new Date(invitation.usedAt), 'MMM d')}
                        </span>
                      ) : new Date(invitation.expiresAt) < new Date() ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                          Expired
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          Active
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Training Configuration Tab */}
      {activeTab === 'training' && trainingConfig && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Training-Konfiguration
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Konfiguriere Modell-Namen und Speicherort für LLM-Training
              </p>
            </div>
            <button
              onClick={handleSaveTrainingConfig}
              disabled={savingTrainingConfig}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
            >
              {savingTrainingConfig ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>

          <InlineHelp
            title="Training-Konfiguration"
            category="expert"
            content={
              <div className="space-y-3">
                <p>
                  Diese Einstellungen überschreiben ENV-Variablen und bestimmen, wo trainierte Modelle gespeichert werden und wie sie heißen.
                </p>
                <div>
                  <p className="font-semibold mb-1">Priorität:</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2 text-sm">
                    <li>Admin-Settings (hier konfiguriert)</li>
                    <li>ENV-Variablen (Fallback)</li>
                    <li>Standard-Werte (wenn nichts gesetzt)</li>
                  </ol>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <strong>Hinweis:</strong> Leere Felder verwenden ENV-Variablen oder Standard-Werte.
                </p>
              </div>
            }
          />

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Modell-Speicherort
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Speicherort für trainierte Modelle
                </label>
                <input
                  type="text"
                  value={trainingConfig.trainingModelOutputDir || ''}
                  onChange={(e) => setTrainingConfig({ ...trainingConfig, trainingModelOutputDir: e.target.value })}
                  placeholder={trainingConfig.envTrainingModelOutputDir || './data/training/models'}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Aktuell verwendet: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{trainingConfig.currentTrainingModelOutputDir}</code>
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  ENV-Fallback: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{trainingConfig.envTrainingModelOutputDir}</code>
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Modell-Namen
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email-Modell-Name
                </label>
                <input
                  type="text"
                  value={trainingConfig.trainingEmailModelName || ''}
                  onChange={(e) => setTrainingConfig({ ...trainingConfig, trainingEmailModelName: e.target.value })}
                  placeholder={trainingConfig.envTrainingEmailModelName || 'travstats-email-custom'}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Aktuell: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{trainingConfig.currentTrainingEmailModelName}</code>
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  ENV: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{trainingConfig.envTrainingEmailModelName}</code>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Vision-Modell-Name
                </label>
                <input
                  type="text"
                  value={trainingConfig.trainingVisionModelName || ''}
                  onChange={(e) => setTrainingConfig({ ...trainingConfig, trainingVisionModelName: e.target.value })}
                  placeholder={trainingConfig.envTrainingVisionModelName || 'travstats-vision-custom'}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Aktuell: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{trainingConfig.currentTrainingVisionModelName}</code>
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  ENV: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{trainingConfig.envTrainingVisionModelName}</code>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Parser Settings Tab */}
      {activeTab === 'parsers' && parserSettings && (
        <div className="space-y-6">
          {/* Header with Save Button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Global Parser Configuration
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Configure default parser settings and API keys for all users
              </p>
            </div>
            <button
              onClick={handleSaveParserSettings}
              disabled={savingParsers}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
            >
              {savingParsers ? t('common.buttons.saving') : t('admin.saveSettings')}
            </button>
          </div>

          {/* Global API Keys */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Global API Keys
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              These API keys will be used system-wide unless users provide their own keys (if allowed below).
              Keys are encrypted at the application level.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  value={parserSettings.globalOpenaiApiKey || ''}
                  onChange={(e) => setParserSettings({ ...parserSettings, globalOpenaiApiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white font-mono text-sm"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Get from{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    platform.openai.com
                  </a>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Claude API Key
                </label>
                <input
                  type="password"
                  value={parserSettings.globalClaudeApiKey || ''}
                  onChange={(e) => setParserSettings({ ...parserSettings, globalClaudeApiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white font-mono text-sm"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Get from{' '}
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    console.anthropic.com
                  </a>
                </p>
              </div>
            </div>
          </div>

          {/* User Permissions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              User Permissions
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Control whether users can provide their own API keys for cloud-based parsers.
            </p>
            <div className="space-y-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={parserSettings.allowUserApiKeys}
                  onChange={(e) => setParserSettings({ ...parserSettings, allowUserApiKeys: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    Allow users to provide their own API keys
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Users can enter their own OpenAI/Claude API keys in their settings. Their keys will take precedence over global keys.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={parserSettings.requireUserApiKeys}
                  onChange={(e) => setParserSettings({ ...parserSettings, requireUserApiKeys: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    Require users to provide their own API keys
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Force users to provide their own API keys. Global keys will not be used. Only free parsers (Ollama, Tesseract, Regex) will work without user keys.
                  </p>
                </div>
              </label>
            </div>

            {parserSettings.requireUserApiKeys && !parserSettings.allowUserApiKeys && (
              <div className="mt-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  ⚠️ Warning: You have enabled "Require user API keys" but disabled "Allow user API keys".
                  This means users cannot use cloud-based parsers (OpenAI, Claude).
                </p>
              </div>
            )}
          </div>

          {/* Default Parser Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Default Parser Settings
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              These defaults will be applied to new user accounts. Users can change them in their settings.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Default Vision Parser (Boarding Pass)
                </label>
                <select
                  value={parserSettings.defaultVisionParser}
                  onChange={(e) => setParserSettings({ ...parserSettings, defaultVisionParser: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="auto">🤖 Auto (Recommended)</option>
                  <option value="ollama">🖥️ Ollama Vision</option>
                  <option value="openai">☁️ OpenAI GPT-4 Vision</option>
                  <option value="claude">☁️ Claude 3.5 Vision</option>
                  <option value="tesseract">📝 Tesseract OCR</option>
                  <option value="manual">✋ Manual Entry</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Auto mode automatically selects the best available parser
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Default Text Parser (Email)
                </label>
                <select
                  value={parserSettings.defaultTextParser}
                  onChange={(e) => setParserSettings({ ...parserSettings, defaultTextParser: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="auto">🤖 Auto (Recommended)</option>
                  <option value="ollama">🖥️ Ollama</option>
                  <option value="openai">☁️ OpenAI GPT-4</option>
                  <option value="claude">☁️ Claude 3.5</option>
                  <option value="regex">🔤 Regex Fallback</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Auto mode automatically selects the best available parser
                </p>
              </div>
            </div>
          </div>

          {/* Help Section */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-blue-900 dark:text-blue-100">
                <p className="font-medium mb-2">Parser Configuration Guide</p>
                <ul className="space-y-1 text-xs">
                  <li>• <strong>Free Options</strong>: Ollama (local AI, GPU recommended), Tesseract (OCR), Regex (pattern matching)</li>
                  <li>• <strong>Cloud Options</strong>: OpenAI (~$0.01-0.05/image, $0.002-0.01/email), Claude (~$0.01-0.03/image, $0.003-0.015/email)</li>
                  <li>• <strong>Auto Mode</strong>: System prioritizes cloud AI &gt; local AI &gt; OCR/regex based on availability</li>
                  <li>• <strong>API Keys</strong>: Global keys are shared across all users unless users provide their own</li>
                  <li>• <strong>Fallback Chain</strong>: Users can configure custom fallback sequences in their settings</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logging Tab */}
      {activeTab === 'logging' && loggingConfig && (
        <div className="space-y-6">
          {/* Header with Quick Actions */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Debug Logging & Diagnostics
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Advanced logging for troubleshooting and monitoring
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleToggleDebugLogging}
                className={`px-4 py-2 rounded-lg transition font-medium ${
                  loggingConfig.logLevel === 'debug'
                    ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {loggingConfig.logLevel === 'debug' ? '🔇 Disable Debug Mode' : '🔊 Enable Debug Mode'}
              </button>
              <button
                onClick={handleSaveLoggingConfig}
                disabled={savingLogging}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
              >
                {savingLogging ? t('common.buttons.saving') : t('admin.saveConfig')}
              </button>
            </div>
          </div>

          {/* Debug Mode Warning */}
          {loggingConfig.logLevel === 'debug' && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium text-yellow-900 dark:text-yellow-100">Debug Mode Active</p>
                  <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-1">
                    Debug logging is enabled with detailed instrumentation. This may impact performance and generate large log files.
                    Consider disabling after troubleshooting.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Statistics */}
          {logStats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Total Log Files</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {logStats.fileCount}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Total Size</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {(logStats.totalSize / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Oldest Log</div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {(() => {
                    try {
                      return logStats.oldestLog ? format(new Date(logStats.oldestLog), 'MMM d, yyyy') : '—';
                    } catch {
                      return '—';
                    }
                  })()}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Newest Log</div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {(() => {
                    try {
                      return logStats.newestLog ? format(new Date(logStats.newestLog), 'MMM d, yyyy') : '—';
                    } catch {
                      return '—';
                    }
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Logging Configuration */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Logging Configuration
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Log Level
                </label>
                <select
                  value={loggingConfig.logLevel}
                  onChange={(e) => setLoggingConfig({ ...loggingConfig, logLevel: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="error">Error (Minimal)</option>
                  <option value="warn">Warning</option>
                  <option value="info">Info (Default)</option>
                  <option value="debug">Debug (Verbose)</option>
                  <option value="trace">Trace (Very Verbose)</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Higher levels include all lower levels (e.g., Debug includes Info, Warn, Error)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Log Retention (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={loggingConfig.logRetentionDays}
                  onChange={(e) => setLoggingConfig({ ...loggingConfig, logRetentionDays: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Log files older than this will be automatically deleted
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={loggingConfig.logHttpRequests}
                  onChange={(e) => setLoggingConfig({ ...loggingConfig, logHttpRequests: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Log HTTP Requests</span>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Log all HTTP requests with timing, IP, user, and status (category: http)
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={loggingConfig.logDatabaseQueries}
                  onChange={(e) => setLoggingConfig({ ...loggingConfig, logDatabaseQueries: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Log Database Queries</span>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Log SQL queries with args and performance metrics (category: database)
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={loggingConfig.logParserOperations}
                  onChange={(e) => setLoggingConfig({ ...loggingConfig, logParserOperations: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Log Parser Operations</span>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Log LLM operations with provider details (category: parser)
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Log Files */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Log Files
              </h3>
              <button
                onClick={handleCleanupLogs}
                className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition"
              >
                🗑️ Cleanup Old Logs
              </button>
            </div>
            {logFiles.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400 text-sm">No log files found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Filename
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Size
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Modified
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {logFiles.map((file) => (
                      <tr key={file.filename}>
                        <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">
                          {file.filename}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            file.category === 'error'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                          }`}>
                            {file.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {(file.size / 1024).toFixed(2)} KB
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {format(new Date(file.modified), 'MMM d, HH:mm')}
                        </td>
                        <td className="px-4 py-3 text-sm space-x-2">
                          <button
                            onClick={() => handleDownloadLogFile(file.filename)}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => handleDeleteLogFile(file.filename)}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Help Section - Replaced with InlineHelp above */}
        </div>
      )}

      {/* Parser Feedback Tab */}
      {activeTab === 'feedback' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Parser Feedback Statistics
              </h2>
              <div className="flex items-center gap-4">
                <label className="text-sm text-gray-600 dark:text-gray-400">
                  Time Period:
                  <select
                    value={feedbackDays}
                    onChange={(e) => setFeedbackDays(Number(e.target.value))}
                    className="ml-2 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                    <option value={365}>Last year</option>
                  </select>
                </label>
              </div>
            </div>

            {feedbackStats ? (
              <div className="space-y-6">
                {/* Overview Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                    <div className="text-blue-600 dark:text-blue-400 text-sm font-medium mb-1">
                      Total Feedback Entries
                    </div>
                    <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">
                      {feedbackStats.total}
                    </div>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                    <div className="text-green-600 dark:text-green-400 text-sm font-medium mb-1">
                      Average Quality Score
                    </div>
                    <div className="text-3xl font-bold text-green-900 dark:text-green-100">
                      {feedbackStats.avgQualityScore}%
                    </div>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                    <div className="text-purple-600 dark:text-purple-400 text-sm font-medium mb-1">
                      Common Issues
                    </div>
                    <div className="text-3xl font-bold text-purple-900 dark:text-purple-100">
                      {feedbackStats.commonIssues.length}
                    </div>
                  </div>
                </div>

                {/* Provider Distribution */}
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Distribution by Parser Provider
                  </h3>
                  {Object.keys(feedbackStats.byProvider).length > 0 ? (
                    <div className="space-y-3">
                      {Object.entries(feedbackStats.byProvider)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .map(([provider, count]) => {
                          const countNum = count as number;
                          const percentage = feedbackStats.total > 0
                            ? Math.round((countNum / feedbackStats.total) * 100)
                            : 0;
                          return (
                            <div key={provider}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                  {provider.toUpperCase()}
                                </span>
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                  {String(countNum)} ({percentage}%)
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                                <div
                                  className="bg-blue-600 h-2 rounded-full transition-all"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400">No data available</p>
                  )}
                </div>

                {/* Source Type Distribution */}
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Distribution by Source Type
                  </h3>
                  {Object.keys(feedbackStats.bySourceType).length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                      {Object.entries(feedbackStats.bySourceType).map(([type, count]) => {
                        const countNum = count as number;
                        const percentage = feedbackStats.total > 0
                          ? Math.round((countNum / feedbackStats.total) * 100)
                          : 0;
                        return (
                          <div key={type} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                            <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                              {type === 'email' ? '📧 Email' : '🎫 Boarding Pass'}
                            </div>
                            <div className="text-2xl font-bold text-gray-900 dark:text-white">
                              {String(countNum)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {percentage}% of total
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400">No data available</p>
                  )}
                </div>

                  {/* Common Issues */}
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Most Common Issues
                    </h3>
                    {feedbackStats.commonIssues.length > 0 ? (
                      <div className="space-y-2">
                        {feedbackStats.commonIssues.map((issue: any, index: number) => (
                          <div
                            key={index}
                            className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700"
                          >
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {issue.issue}
                            </span>
                            <span className="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded-full text-sm font-medium">
                              {issue.count}x
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400">No issues reported</p>
                    )}
                  </div>

                  {/* Feedback Details List */}
                  {feedbackDetails && feedbackDetails.feedback && feedbackDetails.feedback.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        Recent Feedback Entries ({feedbackDetails.total})
                      </h3>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {feedbackDetails.feedback.map((entry: any) => {
                          const payload = entry.payload;
                          return (
                            <div
                              key={entry.id}
                              className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                              onClick={() => setSelectedFeedbackId(entry.id)}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded text-xs font-medium">
                                      {payload.provider}
                                    </span>
                                    <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded text-xs font-medium">
                                      {payload.sourceType}
                                    </span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      payload.qualityScore >= 50
                                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                        : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                                    }`}>
                                      {payload.qualityScore}% quality
                                    </span>
                                  </div>
                                  <div className="text-sm text-gray-600 dark:text-gray-400">
                                    {format(new Date(entry.createdAt), 'PPp')}
                                  </div>
                                  {payload.issues && payload.issues.length > 0 && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      {payload.issues.slice(0, 3).join(', ')}
                                      {payload.issues.length > 3 && ` (+${payload.issues.length - 3} more)`}
                                    </div>
                                  )}
                                </div>
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-gray-400 dark:text-gray-500 mb-2">Loading feedback statistics...</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pattern Updates Tab */}
      {activeTab === 'patterns' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Pattern Updates & Suggestions
              </h2>
              <div className="flex items-center gap-4">
                <button
                  onClick={handleAutoApplyPatterns}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                >
                  Auto-Apply High Confidence (≥90%)
                </button>
                <label className="text-sm text-gray-600 dark:text-gray-400">
                  Time Period:
                  <select
                    value={feedbackDays}
                    onChange={(e) => setFeedbackDays(Number(e.target.value))}
                    className="ml-2 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                    <option value={365}>Last year</option>
                  </select>
                </label>
              </div>
            </div>

            {patternData ? (
              <div className="space-y-6">
                {/* Statistics */}
                {patternData.stats && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                      <div className="text-blue-600 dark:text-blue-400 text-sm font-medium mb-1">
                        Total Patterns
                      </div>
                      <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                        {patternData.stats.total}
                      </div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                      <div className="text-green-600 dark:text-green-400 text-sm font-medium mb-1">
                        Applied
                      </div>
                      <div className="text-2xl font-bold text-green-900 dark:text-green-100">
                        {patternData.stats.applied}
                      </div>
                    </div>
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
                      <div className="text-yellow-600 dark:text-yellow-400 text-sm font-medium mb-1">
                        Pending
                      </div>
                      <div className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">
                        {patternData.stats.pending}
                      </div>
                    </div>
                    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                      <div className="text-purple-600 dark:text-purple-400 text-sm font-medium mb-1">
                        Avg Confidence
                      </div>
                      <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                        {Math.round(patternData.stats.avgConfidence * 100)}%
                      </div>
                    </div>
                  </div>
                )}

                {/* Pending Suggestions */}
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Pending Pattern Suggestions ({patternData.pendingSuggestions?.length || 0})
                  </h3>
                  {patternData.pendingSuggestions && patternData.pendingSuggestions.length > 0 ? (
                    <div className="space-y-4">
                      {patternData.pendingSuggestions.map((suggestion: any) => (
                        <div
                          key={suggestion.id}
                          className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded text-sm font-medium">
                                  {suggestion.field}
                                </span>
                                <span className={`px-2 py-1 rounded text-sm font-medium ${
                                  suggestion.confidence >= 0.9
                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                    : suggestion.confidence >= 0.8
                                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                                }`}>
                                  {Math.round(suggestion.confidence * 100)}% confidence
                                </span>
                              </div>
                              <div className="mb-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Pattern: </span>
                                <code className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-sm font-mono">
                                  {suggestion.pattern}
                                </code>
                              </div>
                              <div className="mb-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Issue: </span>
                                <span className="text-sm text-gray-700 dark:text-gray-300">{suggestion.issue}</span>
                              </div>
                              {suggestion.examples && suggestion.examples.length > 0 && (
                                <div>
                                  <span className="text-sm text-gray-600 dark:text-gray-400">Examples: </span>
                                  <span className="text-sm text-gray-700 dark:text-gray-300">
                                    {suggestion.examples.slice(0, 5).join(', ')}
                                    {suggestion.examples.length > 5 && ` (+${suggestion.examples.length - 5} more)`}
                                  </span>
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => handleApplyPattern(suggestion.id)}
                              className="ml-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400">No pending pattern suggestions</p>
                  )}
                </div>

                {/* Summary */}
                {patternData.summary && (
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Analysis Summary
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Total Issues:</span>
                        <span className="font-medium text-gray-900 dark:text-white">{patternData.summary.totalIssues}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Pattern Suggestions:</span>
                        <span className="font-medium text-gray-900 dark:text-white">{patternData.summary.suggestions}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-gray-400 dark:text-gray-500 mb-2">Loading pattern data...</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feedback Details Modal */}
      {selectedFeedbackId && feedbackDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Feedback Details</h2>
              <button
                onClick={() => setSelectedFeedbackId(null)}
                className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              {(() => {
                const feedback = feedbackDetails.feedback.find((f: any) => f.id === selectedFeedbackId);
                if (!feedback) return <p>Feedback not found</p>;
                const payload = feedback.payload;
                return (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Provider</h3>
                      <p className="text-gray-700 dark:text-gray-300">{payload.provider}</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Quality Score</h3>
                      <p className="text-gray-700 dark:text-gray-300">{payload.qualityScore}%</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Issues</h3>
                      <ul className="list-disc list-inside text-gray-700 dark:text-gray-300">
                        {payload.issues?.map((issue: string, i: number) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                    {payload.parsedResult && (
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Parsed Result</h3>
                        <pre className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg overflow-x-auto text-sm">
                          {JSON.stringify(payload.parsedResult, null, 2)}
                        </pre>
                      </div>
                    )}
                    {payload.correctedResult && (
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Corrected Result</h3>
                        <pre className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg overflow-x-auto text-sm">
                          {JSON.stringify(payload.correctedResult, null, 2)}
                        </pre>
                      </div>
                    )}
                    {payload.userCorrections && payload.userCorrections.length > 0 && (
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-2">User Corrections</h3>
                        <div className="space-y-2">
                          {payload.userCorrections.map((correction: any, i: number) => (
                            <div key={i} className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg">
                              <div className="font-medium text-gray-900 dark:text-white">{correction.field}</div>
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {String(correction.original)} → {String(correction.corrected)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Pattern Apply Confirmation Modal */}
      {showPatternConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Pattern anwenden?
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Möchten Sie dieses Pattern wirklich anwenden? Hinweis: Dies erfordert manuelle Code-Updates.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowPatternConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleApplyPatternConfirm}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Anwenden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto Apply Patterns Confirmation Modal */}
      {showAutoApplyConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Alle Patterns automatisch anwenden?
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Möchten Sie alle hochwertigen Patterns automatisch anwenden? Dies kann mehrere Patterns gleichzeitig betreffen.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAutoApplyConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleAutoApplyPatternsConfirm}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Anwenden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backups Tab */}
      {activeTab === 'backups' && (
        <BackupManagement />
      )}

    </div>
  );
}

