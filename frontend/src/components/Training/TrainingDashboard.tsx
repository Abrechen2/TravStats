import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { trainingApi } from '../../lib/api';
import { logger } from '../../lib/logger';
import { useTranslation } from '../../hooks/useTranslation';
import { useToastStore } from '../../store/toastStore';
import HelpIcon from '../Help/HelpIcon';
import ConfirmModal from './ConfirmModal';
import TrainingDataFilters from './TrainingDataFilters';
import TrainingDataPreview from './TrainingDataPreview';

interface TrainingDashboardProps {
  onEditTrainingData?: (id: string, type: string) => void;
}

interface TrainingJob {
  id: string;
  modelName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  trainingDataIds?: string[];
}

interface TrainingLogEntry {
  timestamp: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface TrainingDataEntry {
  id: string;
  type: 'email' | 'boarding_pass';
  status: 'pending' | 'trained' | 'failed';
  createdAt: string;
  tags?: string[];
  extractedDataCount?: number;
  extractedData?: unknown[];
}

interface JobLogs {
  job: TrainingJob;
  logs: TrainingLogEntry[];
  logFileContent?: string | null;
}

export default function TrainingDashboard({ onEditTrainingData }: TrainingDashboardProps): JSX.Element {
  const { t } = useTranslation('training');
  const addToast = useToastStore((state) => state.addToast);
  const [trainingData, setTrainingData] = useState<TrainingDataEntry[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobLogs, setJobLogs] = useState<Record<string, JobLogs>>({});
  const pollingIntervalRef = useRef<number | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelJobId, setCancelJobId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteDataId, setDeleteDataId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [previewDataId, setPreviewDataId] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    status?: string;
    type?: string;
    tags?: string[];
    search?: string;
  }>({});


  const [filteredTrainingData, setFilteredTrainingData] = useState<TrainingDataEntry[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list');
  const [sortField, setSortField] = useState<'createdAt' | 'type' | 'status'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Define loadJobLogs first since it's used by loadData
  const loadJobLogs = useCallback(async (jobId: string) => {
    try {
      const logsData = await trainingApi.getJobLogs(jobId);
      setJobLogs((prev) => ({
        ...prev,
        [jobId]: logsData,
      }));
    } catch (error) {
      logger.error('Failed to load job logs:', error);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      // Build query params for filtering with validation
      const queryParams = new URLSearchParams();
      if (filters.status && filters.status.length <= 50) {
        queryParams.append('status', filters.status);
      }
      if (filters.type && filters.type.length <= 50) {
        queryParams.append('type', filters.type);
      }
      if (filters.tags && filters.tags.length > 0 && filters.tags.length <= 20) {
        // Validate each tag
        const validTags = filters.tags.filter(tag => tag.length > 0 && tag.length <= 50);
        if (validTags.length > 0) {
          queryParams.append('tags', validTags.join(','));
        }
      }
      if (filters.search && filters.search.length > 0 && filters.search.length <= 200) {
        queryParams.append('search', filters.search);
      }

      const queryString = queryParams.toString();

      const [dataResult, jobsResult] = await Promise.all([
        trainingApi.getData(queryString),
        trainingApi.getJobs(),
      ]);
      setTrainingData(dataResult.trainingData);
      setFilteredTrainingData(dataResult.trainingData);
      setJobs(jobsResult.jobs);

      // Load logs for running jobs
      const runningJobs = jobsResult.jobs.filter((job: TrainingJob) => job.status === 'running' || job.status === 'pending');
      for (const job of runningJobs) {
        await loadJobLogs(job.id);
      }
    } catch (error) {
      logger.error('Failed to load training data:', error);
    } finally {
      setLoading(false);
    }
  }, [filters, loadJobLogs]);

  useEffect(() => {
    loadData();

    // Cleanup polling on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [loadData]);

  // Poll for running jobs - only update jobs and logs, not the whole page
  // Use running job IDs as dependency instead of entire jobs array to prevent infinite loop
  const runningJobIdsArray = useMemo(
    () =>
      jobs
        .filter((job) => job.status === 'running' || job.status === 'pending')
        .map((job) => job.id)
        .sort(),
    [jobs]
  );

  const runningJobIds = runningJobIdsArray.join(',');

  useEffect(() => {
    if (runningJobIdsArray.length > 0) {
      // Start polling every 3 seconds for running jobs
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      // Store job IDs in a variable to use in the interval
      const jobIds = [...runningJobIdsArray];
      pollingIntervalRef.current = setInterval(async () => {
        // Only update jobs status and logs, not the whole page
        try {
          const jobsResult = await trainingApi.getJobs();
          setJobs(jobsResult.jobs);

          // Update logs for running jobs
          jobIds.forEach((jobId) => {
            loadJobLogs(jobId);
          });
        } catch (error) {
          logger.error('Failed to poll job status:', error);
        }
      }, 3000);
    } else {
      // Stop polling if no running jobs
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [runningJobIds, loadJobLogs]);

  const handleFilterChange = useCallback((newFilters: {
    status?: string;
    type?: string;
    tags?: string[];
    search?: string;
  }) => {
    setFilters((prevFilters) => {
      // Only update if filters actually changed
      const prevStatus = prevFilters.status || '';
      const prevType = prevFilters.type || '';
      const prevTags = (prevFilters.tags || []).sort().join(',');
      const prevSearch = prevFilters.search || '';

      const newStatus = newFilters.status || '';
      const newType = newFilters.type || '';
      const newTags = (newFilters.tags || []).sort().join(',');
      const newSearch = newFilters.search || '';

      if (
        prevStatus === newStatus &&
        prevType === newType &&
        prevTags === newTags &&
        prevSearch === newSearch
      ) {
        return prevFilters; // No change, return previous to prevent re-render
      }

      return newFilters;
    });
  }, []);

  const toggleJobExpanded = async (jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
    } else {
      setExpandedJobId(jobId);
      if (!jobLogs[jobId]) {
        await loadJobLogs(jobId);
      }
    }
  };

  const getProgressFromLogs = (logs: JobLogs | undefined, startedAt?: string | Date): { phase: string; progress: number; estimatedTimeRemaining?: number } => {
    if (!logs) {
      return { phase: 'Initialisierung', progress: 0 };
    }

    const logMessages = logs.logs.map((log) => log.message.toLowerCase());
    const logFileContent = logs.logFileContent?.toLowerCase() || '';

    let progress = 0;
    let phase = 'Initialisierung';

    // Check for different phases - improved pattern matching
    // Check for completion first
    if (logFileContent.includes('training completed successfully') ||
      logFileContent.includes('training completed') ||
      logMessages.some((m) => m.includes('training completed'))) {
      phase = 'Abgeschlossen';
      progress = 100;
    }
    // Check for saving model
    else if (logFileContent.includes('saving model') ||
      logFileContent.includes('save_model') ||
      logMessages.some((m) => m.includes('saving model'))) {
      phase = 'Speichere Modell';
      progress = 90;
    }
    // Check for training progress with epoch information
    else if (logFileContent.includes('epoch') ||
      logFileContent.includes('step') ||
      logFileContent.includes('training') ||
      logFileContent.includes('loss')) {
      // Try to extract epoch information - multiple patterns
      const epochPatterns = [
        /epoch\s+(\d+)\s*\/\s*(\d+)/i,
        /epoch\s+(\d+)\s+of\s+(\d+)/i,
        /epoch:\s*(\d+)\s*\/\s*(\d+)/i,
      ];

      let epochMatch = null;
      for (const pattern of epochPatterns) {
        epochMatch = logFileContent.match(pattern);
        if (epochMatch) break;
      }

      if (epochMatch) {
        const currentEpoch = parseInt(epochMatch[1]);
        const totalEpochs = parseInt(epochMatch[2]);
        const epochProgress = (currentEpoch / totalEpochs) * 100;

        // Try to extract step information for more granular progress
        const stepMatch = logFileContent.match(/step\s+(\d+)\s*\/\s*(\d+)/i) ||
          logFileContent.match(/step:\s*(\d+)\s*\/\s*(\d+)/i);

        if (stepMatch) {
          const currentStep = parseInt(stepMatch[1]);
          const totalSteps = parseInt(stepMatch[2]);
          const stepProgress = (currentStep / totalSteps) * 100;
          const overallProgress = 30 + (epochProgress * 0.5) + (stepProgress * 0.5 / totalEpochs);
          phase = `Training (Epoche ${currentEpoch}/${totalEpochs}, Step ${currentStep}/${totalSteps})`;
          progress = Math.min(90, overallProgress);
        } else {
          phase = `Training (Epoche ${currentEpoch}/${totalEpochs})`;
          progress = 30 + epochProgress * 0.5;
        }
      }
      // Check for step information without epoch
      else {
        const stepMatch = logFileContent.match(/step\s+(\d+)\s*\/\s*(\d+)/i) ||
          logFileContent.match(/step:\s*(\d+)\s*\/\s*(\d+)/i);
        if (stepMatch) {
          const currentStep = parseInt(stepMatch[1]);
          const totalSteps = parseInt(stepMatch[2]);
          const stepProgress = (currentStep / totalSteps) * 100;
          phase = `Training (Step ${currentStep}/${totalSteps})`;
          progress = 30 + stepProgress * 0.5;
        } else {
          phase = 'Training läuft';
          progress = 50;
        }
      }
    }
    // Check for dataset preparation
    else if (logFileContent.includes('preparing dataset') ||
      logFileContent.includes('preparing dataset') ||
      logFileContent.includes('tokenize') ||
      logMessages.some((m) => m.includes('preparing dataset'))) {
      phase = 'Bereite Datensatz vor';
      progress = 25;
    }
    // Check for model preparation
    else if (logFileContent.includes('preparing model') ||
      logFileContent.includes('prepare_model') ||
      logFileContent.includes('lora') ||
      logMessages.some((m) => m.includes('preparing model'))) {
      phase = 'Bereite Modell vor';
      progress = 20;
    }
    // Check for loading model
    else if (logFileContent.includes('loading tokenizer') ||
      logFileContent.includes('loading model') ||
      logFileContent.includes('from_pretrained') ||
      logMessages.some((m) => m.includes('loading'))) {
      phase = 'Lade Modell';
      progress = 15;
    }
    // Check for training start
    else if (logMessages.some((m) => m.includes('starting lora training')) ||
      logMessages.some((m) => m.includes('executing training')) ||
      logFileContent.includes('starting lora training')) {
      phase = 'Starte Training';
      progress = 10;
    }
    // Default
    else {
      phase = 'Initialisierung';
      progress = 5;
    }

    // Calculate estimated time remaining
    let estimatedTimeRemaining: number | undefined;
    if (startedAt && progress > 0 && progress < 100) {
      const startTime = new Date(startedAt).getTime();
      const currentTime = Date.now();
      const elapsed = currentTime - startTime; // in milliseconds
      const progressDecimal = progress / 100;

      if (progressDecimal > 0) {
        const totalEstimated = elapsed / progressDecimal;
        const remaining = totalEstimated - elapsed;
        estimatedTimeRemaining = Math.max(0, remaining);
      }
    }

    return { phase, progress, estimatedTimeRemaining };
  };

  const formatEstimatedTime = (milliseconds: number | undefined): string => {
    if (!milliseconds || milliseconds === 0) {
      return '';
    }

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `~${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `~${minutes}m ${seconds % 60}s`;
    } else {
      return `~${seconds}s`;
    }
  };

  const handleTriggerTraining = async () => {
    // if (!confirm('Training jetzt starten?')) return;

    setTriggering(true);
    try {
      await trainingApi.triggerTraining();
      await loadData();
      addToast('success', t('training:toasts.trainingStarted'));
    } catch (error: unknown) {
      logger.error('Failed to trigger training:', error);
      const axiosError = error as { response?: { data?: { message?: string } } };
      addToast('error', axiosError.response?.data?.message || t('training:errors.startTrainingFailed'));
    } finally {
      setTriggering(false);
    }
  };

  const handleDeleteTrainingDataClick = (id: string) => {
    setDeleteDataId(id);
    setDeleteModalOpen(true);
  };

  const handleDeleteTrainingData = async () => {
    if (!deleteDataId) return;

    setDeleteModalOpen(false);
    setDeleting(deleteDataId);
    const id = deleteDataId;
    setDeleteDataId(null);

    try {
      await trainingApi.deleteTrainingData(id);
      await loadData();
    } catch (error: unknown) {
      logger.error('Failed to delete training data:', error);
      const axiosError = error as { response?: { data?: { message?: string } } };
      addToast('error', axiosError.response?.data?.message || t('training:errors.deleteFailed'));
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const deletableItems = displayTrainingData.filter(
      (data) => data.status === 'pending' && !runningJobDataIds.has(data.id)
    );
    if (selectedItems.size === deletableItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(deletableItems.map((d) => d.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;

    setBulkDeleteModalOpen(false);
    setBulkDeleting(true);

    try {
      // Delete all selected items
      await Promise.all(
        Array.from(selectedItems).map((id) => trainingApi.deleteTrainingData(id))
      );
      setSelectedItems(new Set());
      await loadData();
    } catch (error: unknown) {
      logger.error('Failed to bulk delete training data:', error);
      addToast('error', t('training:errors.bulkDeleteFailed'));
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleEditTrainingData = (id: string, type: string) => {
    if (onEditTrainingData) {
      onEditTrainingData(id, type);
    }
  };

  const handleCancelTrainingClick = (jobId: string) => {
    setCancelJobId(jobId);
    setCancelModalOpen(true);
  };

  const handleCancelTraining = async () => {
    if (!cancelJobId) return;

    setCancelModalOpen(false);
    setCancelling(cancelJobId);
    const jobId = cancelJobId;
    setCancelJobId(null);
    try {
      await trainingApi.cancelTraining(jobId);

      // Immediately update the job status optimistically
      setJobs((prevJobs) =>
        prevJobs.map((job) =>
          job.id === jobId
            ? { ...job, status: 'cancelled', completedAt: new Date().toISOString() }
            : job
        )
      );

      // Remove from job logs
      setJobLogs((prev) => {
        const updated = { ...prev };
        delete updated[jobId];
        return updated;
      });

      // Reload data after a short delay to get the latest status from server
      setTimeout(() => {
        loadData();
      }, 500);
    } catch (error: unknown) {
      logger.error('Failed to cancel training:', error);
      const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
      const errorMessage = axiosError.response?.data?.message || axiosError.message || t('training:errors.cancelTrainingFailed');
      addToast('error', errorMessage);

      // Reload data to get actual status
      loadData();
    } finally {
      setCancelling(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'running':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t('loading')}</p>
      </div>
    );
  }

  const pendingCount = trainingData.filter((d) => d.status === 'pending').length;
  let displayTrainingData = filteredTrainingData.length > 0 ? filteredTrainingData : trainingData;

  // Sort training data
  displayTrainingData = [...displayTrainingData].sort((a, b) => {
    let aValue: string | number = a[sortField] ?? '';
    let bValue: string | number = b[sortField] ?? '';

    if (sortField === 'createdAt') {
      aValue = new Date(String(aValue)).getTime();
      bValue = new Date(String(bValue)).getTime();
    } else {
      aValue = String(aValue).toLowerCase();
      bValue = String(bValue).toLowerCase();
    }

    if (sortDirection === 'asc') {
      return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
    } else {
      return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
    }
  });

  const handleSort = (field: 'createdAt' | 'type' | 'status') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Get training data IDs that are currently being used in running jobs
  const runningJobDataIds = new Set<string>();
  jobs
    .filter((job) => job.status === 'running' || job.status === 'pending')
    .forEach((job) => {
      if (job.trainingDataIds && Array.isArray(job.trainingDataIds)) {
        job.trainingDataIds.forEach((id: string) => runningJobDataIds.add(id));
      }
    });

  // Calculate statistics
  // Helper function to get extracted data count
  const getExtractedDataCount = (data: TrainingDataEntry): number => {
    // Prefer extractedDataCount if available (from API)
    if (typeof data.extractedDataCount === 'number') {
      return data.extractedDataCount;
    }
    // Fallback to extractedData array length
    if (data.extractedData && Array.isArray(data.extractedData)) {
      return data.extractedData.length;
    }
    return 0;
  };

  const stats = {
    total: trainingData.length,
    pending: trainingData.filter((d) => d.status === 'pending').length,
    trained: trainingData.filter((d) => d.status === 'trained').length,
    failed: trainingData.filter((d) => d.status === 'failed').length,
    emails: trainingData.filter((d) => d.type === 'email').length,
    boardingPasses: trainingData.filter((d) => d.type === 'boarding_pass').length,
    totalFlights: trainingData.reduce((sum, d) => {
      return sum + getExtractedDataCount(d);
    }, 0),
    avgFlightsPerEmail: (() => {
      const emails = trainingData.filter((d) => d.type === 'email');
      if (emails.length === 0) return 0;
      const totalFlights = emails.reduce((sum, d) => sum + getExtractedDataCount(d), 0);
      return (totalFlights / emails.length).toFixed(2);
    })(),
    totalTags: Array.from(new Set(trainingData.flatMap((d) => d.tags || []))).length,
    jobsCompleted: jobs.filter((j) => j.status === 'completed').length,
    jobsRunning: jobs.filter((j) => j.status === 'running' || j.status === 'pending').length,
    jobsFailed: jobs.filter((j) => j.status === 'failed').length,
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('stats.totalTrainingData')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
            {t('stats.pending')}
            <HelpIcon
              content={t('stats.pendingHelp')}
              position="top"
            />
          </div>
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.pending}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
            {t('stats.trained')}
            <HelpIcon
              content={t('stats.trainedHelp')}
              position="top"
            />
          </div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.trained}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('stats.trainingJobs')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{jobs.length}</div>
        </div>
      </div>

      {/* Detailed Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('stats.emails')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.emails}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('stats.boardingPasses')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.boardingPasses}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('stats.totalFlights')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalFlights}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('stats.avgFlightsPerEmail')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.avgFlightsPerEmail}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('stats.uniqueTags')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalTags}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('stats.jobsCompleted')}</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.jobsCompleted}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('actions.startTraining')}
              </h3>
              <HelpIcon
                content={t('actions.startTrainingHelp')}
                expandedContent={t('actions.startTrainingHelpExpanded')}
                position="right"
              />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {pendingCount >= 5
                ? t('actions.readyForTraining', { count: pendingCount })
                : t('actions.minimumEntriesRequired', { count: pendingCount })}
            </p>
          </div>
          <button
            onClick={handleTriggerTraining}
            disabled={triggering || pendingCount < 5}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggering ? t('actions.starting') : t('actions.startTraining')}
          </button>
        </div>
      </div>

      {/* Training Jobs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('jobs.title')}</h3>
            <HelpIcon
              content={t('jobs.titleHelp')}
              expandedContent={t('jobs.titleHelpExpanded')}
              position="right"
            />
          </div>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {jobs.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              {t('jobs.noJobs')}
            </div>
          ) : (
            jobs.map((job) => {
              const logs = jobLogs[job.id];
              const isExpanded = expandedJobId === job.id;
              const isRunning = job.status === 'running' || job.status === 'pending';
              const progress = getProgressFromLogs(logs, job.startedAt);

              return (
                <div key={job.id} className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">{job.modelName}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(job.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                          {job.status}
                        </span>
                        <HelpIcon
                          content={`Status: ${job.status === 'pending' ? t('jobs.statusPending') : job.status === 'running' ? t('jobs.statusRunning') : job.status === 'completed' ? t('jobs.statusCompleted') : job.status === 'failed' ? t('jobs.statusFailed') : job.status}`}
                          position="left"
                        />
                      </div>
                      {isRunning && (
                        <button
                          onClick={() => handleCancelTrainingClick(job.id)}
                          disabled={cancelling === job.id}
                          className="px-3 py-1 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {cancelling === job.id ? t('jobs.cancelling') : t('jobs.cancel')}
                        </button>
                      )}
                      <button
                        onClick={() => toggleJobExpanded(job.id)}
                        className="px-3 py-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                      >
                        {isExpanded ? t('jobs.hide') : t('jobs.details')}
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar for running jobs */}
                  {isRunning && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {progress.phase}
                          </span>
                          <HelpIcon
                            content={t('progress.phaseHelp')}
                            expandedContent={t('progress.phaseHelpExpanded')}
                            position="top"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          {progress.estimatedTimeRemaining !== undefined && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {formatEstimatedTime(progress.estimatedTimeRemaining)} {t('progress.remaining')}
                            </span>
                          )}
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {Math.round(progress.progress)}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${progress.progress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  {job.errorMessage && (
                    <div className="mt-2 text-sm text-red-600 dark:text-red-400">
                      {job.errorMessage}
                    </div>
                  )}
                  {job.startedAt && (
                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                      {t('jobs.started')} {new Date(job.startedAt).toLocaleString()}
                    </div>
                  )}
                  {job.completedAt && (
                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                      {t('jobs.completed')} {new Date(job.completedAt).toLocaleString()}
                    </div>
                  )}

                  {/* Expanded Logs View */}
                  {isExpanded && logs && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                        {t('jobs.logsAndProgress')}
                      </h4>
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto">
                        {logs.logFileContent ? (
                          <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono">
                            {logs.logFileContent.split('\n').slice(-100).join('\n')}
                          </pre>
                        ) : logs.logs && logs.logs.length > 0 ? (
                          <div className="space-y-1">
                            {logs.logs.map((log, index) => (
                              <div
                                key={index}
                                className={`text-xs font-mono ${log.level === 'error'
                                  ? 'text-red-600 dark:text-red-400'
                                  : log.level === 'warn'
                                    ? 'text-yellow-600 dark:text-yellow-400'
                                    : 'text-gray-700 dark:text-gray-300'
                                  }`}
                              >
                                <span className="text-gray-500 dark:text-gray-500">
                                  {new Date(log.timestamp).toLocaleTimeString()}
                                </span>{' '}
                                [{log.level.toUpperCase()}] {log.message}
                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                  <div className="ml-4 text-gray-600 dark:text-gray-400">
                                    {JSON.stringify(log.metadata, null, 2)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {t('jobs.noLogsAvailable')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Filters */}
      <TrainingDataFilters trainingData={trainingData} onFilterChange={handleFilterChange} />

      {/* Training Data */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('data.title')}</h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-md">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 text-sm font-medium rounded-l-md ${viewMode === 'list'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
              >
                {t('data.list')}
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 text-sm font-medium rounded-r-md ${viewMode === 'table'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
              >
                {t('data.table')}
              </button>
            </div>
            {displayTrainingData.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={
                    displayTrainingData.filter(
                      (data) => data.status === 'pending' && !runningJobDataIds.has(data.id)
                    ).length > 0 &&
                    selectedItems.size ===
                    displayTrainingData.filter(
                      (data) => data.status === 'pending' && !runningJobDataIds.has(data.id)
                    ).length
                  }
                  onChange={handleSelectAll}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Alle auswählen
              </label>
            )}
          </div>
        </div>
        {selectedItems.size > 0 && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900 dark:text-blue-300">
              {selectedItems.size === 1
                ? t('data.selectedCount', { count: selectedItems.size })
                : t('data.selectedCountPlural', { count: selectedItems.size })}
            </span>
            <button
              onClick={() => setBulkDeleteModalOpen(true)}
              disabled={bulkDeleting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkDeleting ? t('data.deleting') : t('data.deleteSelected')}
            </button>
          </div>
        )}
        {viewMode === 'table' ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-12">
                    <input
                      type="checkbox"
                      checked={
                        displayTrainingData.filter(
                          (data) => data.status === 'pending' && !runningJobDataIds.has(data.id)
                        ).length > 0 &&
                        selectedItems.size ===
                        displayTrainingData.filter(
                          (data) => data.status === 'pending' && !runningJobDataIds.has(data.id)
                        ).length
                      }
                      onChange={handleSelectAll}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('type')}
                  >
                    <div className="flex items-center gap-2">
                      {t('data.type')}
                      {sortField === 'type' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-2">
                      {t('data.status')}
                      {sortField === 'status' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    {t('data.tags')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('createdAt')}
                  >
                    <div className="flex items-center gap-2">
                      {t('data.created')}
                      {sortField === 'createdAt' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    {t('data.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {displayTrainingData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                      {trainingData.length === 0
                        ? t('data.noData')
                        : t('data.noMatchingData')}
                    </td>
                  </tr>
                ) : (
                  displayTrainingData.map((data) => {
                    const isInUse = runningJobDataIds.has(data.id);
                    const canEdit = data.status === 'pending' && !isInUse;

                    return (
                      <tr key={data.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {canEdit && (
                            <input
                              type="checkbox"
                              checked={selectedItems.has(data.id)}
                              onChange={() => handleToggleSelect(data.id)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {data.type === 'email' ? '📧 Email' : '🎫 Boarding Pass'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {isInUse && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400">
                                {t('data.beingTrained')}
                              </span>
                            )}
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(data.status)}`}>
                              {data.status}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {data.tags && data.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {data.tags.map((tag: string) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded text-xs"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400 dark:text-gray-500">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {new Date(data.createdAt).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-2">
                            {canEdit && (
                              <>
                                <button
                                  onClick={() => setPreviewDataId(data.id)}
                                  className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300"
                                >
                                  {t('data.preview')}
                                </button>
                                {onEditTrainingData && (
                                  <button
                                    onClick={() => handleEditTrainingData(data.id, data.type)}
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                                  >
                                    {t('data.edit')}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteTrainingDataClick(data.id)}
                                  disabled={deleting === data.id}
                                  className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {deleting === data.id ? t('data.deleting') : t('data.delete')}
                                </button>
                              </>
                            )}
                            {!canEdit && data.status === 'pending' && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                                {t('data.inUse')}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {displayTrainingData.length === 0 ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                {trainingData.length === 0
                  ? t('data.noData')
                  : t('data.noMatchingData')}
              </div>
            ) : (
              displayTrainingData.map((data) => {
                const isInUse = runningJobDataIds.has(data.id);
                const canEdit = data.status === 'pending' && !isInUse;

                return (
                  <div key={data.id} className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        {canEdit && (
                          <input
                            type="checkbox"
                            checked={selectedItems.has(data.id)}
                            onChange={() => handleToggleSelect(data.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        )}
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-white">{data.type}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {new Date(data.createdAt).toLocaleString()}
                          </div>
                          {data.tags && data.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {data.tags.map((tag: string) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded text-xs"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {isInUse && (
                          <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400">
                            {t('data.beingTrained')}
                          </span>
                        )}
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(data.status)}`}>
                          {data.status}
                        </span>
                        {canEdit && (
                          <>
                            <button
                              onClick={() => setPreviewDataId(data.id)}
                              className="px-3 py-1 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300"
                            >
                              {t('data.preview')}
                            </button>
                            {onEditTrainingData && (
                              <button
                                onClick={() => handleEditTrainingData(data.id, data.type)}
                                className="px-3 py-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                              >
                                {t('data.edit')}
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteTrainingDataClick(data.id)}
                              disabled={deleting === data.id}
                              className="px-3 py-1 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {deleting === data.id ? t('data.deleting') : t('data.delete')}
                            </button>
                          </>
                        )}
                        {!canEdit && data.status === 'pending' && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                            {t('data.usedForTraining')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Cancel Training Modal */}
      <ConfirmModal
        isOpen={cancelModalOpen}
        onClose={() => {
          setCancelModalOpen(false);
          setCancelJobId(null);
        }}
        onConfirm={handleCancelTraining}
        title={t('modal.cancelTraining.title')}
        message={t('modal.cancelTraining.message')}
        confirmText={t('modal.cancelTraining.confirm')}
        cancelText={t('modal.cancelTraining.cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700 focus:ring-red-500"
        isLoading={cancelling !== null}
      />

      {/* Delete Training Data Modal */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setDeleteDataId(null);
        }}
        onConfirm={handleDeleteTrainingData}
        title={t('modal.deleteTrainingData.title')}
        message={t('modal.deleteTrainingData.message')}
        confirmText={t('modal.deleteTrainingData.confirm')}
        cancelText={t('modal.deleteTrainingData.cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700 focus:ring-red-500"
        isLoading={deleting !== null}
      />

      {/* Bulk Delete Modal */}
      <ConfirmModal
        isOpen={bulkDeleteModalOpen}
        onClose={() => setBulkDeleteModalOpen(false)}
        onConfirm={handleBulkDelete}
        title={t('modal.bulkDelete.title')}
        message={selectedItems.size === 1
          ? t('modal.bulkDelete.message', { count: selectedItems.size })
          : t('modal.bulkDelete.messagePlural', { count: selectedItems.size })}
        confirmText={t('modal.bulkDelete.confirm')}
        cancelText={t('modal.bulkDelete.cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700 focus:ring-red-500"
        isLoading={bulkDeleting}
      />

      {/* Preview Modal */}
      {previewDataId && (
        <TrainingDataPreview
          trainingDataId={previewDataId}
          isOpen={!!previewDataId}
          onClose={() => setPreviewDataId(null)}
        />
      )}
    </div>
  );
}

