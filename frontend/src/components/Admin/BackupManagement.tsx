import { useState, useEffect } from 'react';
import { backupApi } from '../../lib/api';
import { useToastStore } from '../../store/toastStore';
import { format } from 'date-fns';
import { logger } from '../../lib/logger';
import { useTranslation } from '../../hooks/useTranslation';

interface Backup {
  id: string;
  type: string;
  status: string;
  backupPath: string;
  size: string;
  retentionDays: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  metadata: any;
  syncedToCloud: boolean;
  cloudSyncAt: string | null;
  createdAt: string;
  fileExists?: boolean;
}

interface RestoreModalProps {
  backup: Backup;
  onClose: () => void;
  onConfirm: (scope: 'full' | 'database' | 'files', createBackupBefore: boolean, targetDatabaseUrl?: string) => void;
}

function RestoreModal({ backup, onClose, onConfirm }: RestoreModalProps) {
  const { t } = useTranslation(['admin', 'common']);
  const [scope, setScope] = useState<'full' | 'database' | 'files'>('full');
  const [createBackupBefore, setCreateBackupBefore] = useState(true);
  const [targetDatabaseUrl, setTargetDatabaseUrl] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const handleConfirm = () => {
    if (confirmText !== t('admin:backup.restore.confirmText')) {
      return;
    }
    onConfirm(scope, createBackupBefore, targetDatabaseUrl || undefined);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6">
        <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
          ⚠️ {t('admin:backup.restore.title')}
        </h2>
        
        <div className="space-y-4 mb-6">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-200 font-semibold">
              {t('admin:backup.restore.warning')}
            </p>
            <p className="text-red-700 dark:text-red-300 text-sm mt-2">
              {t('admin:backup.restore.backupFrom', { date: backup.completedAt ? format(new Date(backup.completedAt), 'dd.MM.yyyy HH:mm') : t('common:labels.unknown') })}
            </p>
          </div>

          <div>
            <label className="label">{t('admin:backup.restore.scope')}</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'full' | 'database' | 'files')}
              className="input"
            >
              <option value="full">{t('admin:backup.restore.scopeFull')}</option>
              <option value="database">{t('admin:backup.restore.scopeDatabase')}</option>
              <option value="files">{t('admin:backup.restore.scopeFiles')}</option>
            </select>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={createBackupBefore}
              onChange={(e) => setCreateBackupBefore(e.target.checked)}
              className="h-4 w-4"
            />
            <span>{t('admin:backup.restore.createBackupBefore')}</span>
          </label>

          <div>
            <label className="label">
              {t('admin:backup.restore.targetDatabaseUrl')}
            </label>
            <input
              type="text"
              value={targetDatabaseUrl}
              onChange={(e) => setTargetDatabaseUrl(e.target.value)}
              placeholder={t('admin:backup.restore.targetDatabaseUrlPlaceholder')}
              className="input"
            />
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('admin:backup.restore.targetDatabaseUrlHelp')}
            </p>
          </div>

          <div>
            <label className="label">
              {t('admin:backup.restore.confirmLabel', { text: t('admin:backup.restore.confirmText') })}
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="input"
              placeholder={t('admin:backup.restore.confirmText')}
            />
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmText !== t('admin:backup.restore.confirmText')}
            className="btn-danger disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('admin:backup.restore.confirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BackupManagement() {
  const { t } = useTranslation(['admin', 'common']);
  const addToast = useToastStore((state) => state.addToast);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoreModal, setRestoreModal] = useState<Backup | null>(null);
  const [status, setStatus] = useState<{ running: boolean; currentBackup: any } | null>(null);

  const loadBackups = async () => {
    try {
      setLoading(true);
      const data = await backupApi.list();
      setBackups(data.backups);
    } catch (error) {
      logger.error('Failed to load backups:', error);
      addToast('error', t('admin:backup.toasts.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadStatus = async () => {
    try {
      const data = await backupApi.getStatus();
      setStatus(data);
    } catch (error) {
      logger.error('Failed to load backup status:', error);
    }
  };

  useEffect(() => {
    loadBackups();
    loadStatus();
    const interval = setInterval(() => {
      loadBackups();
      loadStatus();
    }, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      await backupApi.create({ type: 'full' });
      addToast('success', t('admin:backup.toasts.started'));
      setTimeout(() => {
        loadBackups();
        loadStatus();
      }, 1000);
    } catch (error) {
      logger.error('Failed to create backup:', error);
      addToast('error', t('admin:backup.toasts.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (backup: Backup) => {
    try {
      const blob = await backupApi.download(backup.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${backup.id}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      addToast('success', t('admin:backup.toasts.downloading'));
    } catch (error) {
      logger.error('Failed to download backup:', error);
      addToast('error', t('admin:backup.toasts.downloadFailed'));
    }
  };

  const handleRestore = async (scope: 'full' | 'database' | 'files', createBackupBefore: boolean, targetDatabaseUrl?: string) => {
    if (!restoreModal) return;

    try {
      await backupApi.restore(restoreModal.id, {
        scope,
        createBackupBefore,
        targetDatabaseUrl,
      });
      addToast('success', t('admin:backup.toasts.restoring'));
      setRestoreModal(null);
      setTimeout(() => {
        loadBackups();
        loadStatus();
      }, 2000);
    } catch (error) {
      logger.error('Failed to restore backup:', error);
      addToast('error', t('admin:backup.toasts.restoreFailed'));
    }
  };

  const handleDelete = async (backup: Backup) => {
    if (!confirm(t('admin:backup.deleteConfirm', { date: backup.completedAt ? format(new Date(backup.completedAt), 'dd.MM.yyyy HH:mm') : t('common:labels.unknown') }))) {
      return;
    }

    try {
      await backupApi.delete(backup.id);
      addToast('success', t('admin:backup.toasts.deleted'));
      loadBackups();
    } catch (error) {
      logger.error('Failed to delete backup:', error);
      addToast('error', t('admin:backup.toasts.deleteFailed'));
    }
  };

  const formatSize = (bytes: string) => {
    const size = parseInt(bytes, 10);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 dark:text-green-400';
      case 'running':
        return 'text-blue-600 dark:text-blue-400';
      case 'failed':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return t('admin:backup.status.completed');
      case 'running':
        return t('admin:backup.status.running');
      case 'failed':
        return t('admin:backup.status.failed');
      case 'pending':
        return t('admin:backup.status.pending');
      default:
        return status;
    }
  };

  if (loading) {
    return <div className="text-center py-8">{t('admin:backup.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('admin:backup.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('admin:backup.description')}
          </p>
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={creating || status?.running}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? t('admin:backup.creating') : status?.running ? t('admin:backup.running') : t('admin:backup.createNow')}
        </button>
      </div>

      {status?.running && status.currentBackup && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-blue-800 dark:text-blue-200">
            <strong>{t('admin:backup.running')}:</strong> {t('admin:backup.startedAt', { date: status.currentBackup.startedAt ? format(new Date(status.currentBackup.startedAt), 'dd.MM.yyyy HH:mm:ss') : t('common:labels.unknown') })}
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('admin:backup.table.date')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('admin:backup.table.status')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('admin:backup.table.size')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('admin:backup.table.type')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('admin:backup.table.cloud')}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('common:labels.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {backups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                  {t('admin:backup.noBackups')}
                </td>
              </tr>
            ) : (
              backups.map((backup) => (
                <tr key={backup.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {backup.completedAt
                      ? format(new Date(backup.completedAt), 'dd.MM.yyyy HH:mm')
                      : backup.startedAt
                      ? format(new Date(backup.startedAt), 'dd.MM.yyyy HH:mm')
                      : t('common:labels.unknown')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${getStatusColor(backup.status)}`}>
                      {getStatusText(backup.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {backup.status === 'completed' ? formatSize(backup.size) : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {backup.type === 'full' ? t('admin:backup.type.full') : t('admin:backup.type.partial')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {backup.syncedToCloud ? (
                      <span className="text-green-600 dark:text-green-400">✓</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      {backup.status === 'completed' && backup.fileExists !== false && (
                        <>
                          <button
                            onClick={() => handleDownload(backup)}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {t('admin:backup.actions.download')}
                          </button>
                          <button
                            onClick={() => setRestoreModal(backup)}
                            className="text-orange-600 hover:text-orange-900 dark:text-orange-400 dark:hover:text-orange-300"
                          >
                            {t('admin:backup.actions.restore')}
                          </button>
                        </>
                      )}
                      {backup.status !== 'running' && (
                        <button
                          onClick={() => handleDelete(backup)}
                          className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                        >
                          {t('common:buttons.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {restoreModal && (
        <RestoreModal
          backup={restoreModal}
          onClose={() => setRestoreModal(null)}
          onConfirm={handleRestore}
        />
      )}
    </div>
  );
}






