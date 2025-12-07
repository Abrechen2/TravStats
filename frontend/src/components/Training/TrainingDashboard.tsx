import { useState, useEffect, useRef } from 'react';
import { trainingApi } from '../../lib/api';
import { logger } from '../../lib/logger';

interface TrainingDashboardProps {
  onEditTrainingData?: (id: string, type: string) => void;
}

interface JobLogs {
  job: any;
  logs: any[];
  logFileContent?: string | null;
}

export default function TrainingDashboard({ onEditTrainingData }: TrainingDashboardProps) {
  const [trainingData, setTrainingData] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobLogs, setJobLogs] = useState<Record<string, JobLogs>>({});
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadData();
    
    // Cleanup polling on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Poll for running jobs - only update jobs and logs, not the whole page
  useEffect(() => {
    const runningJobs = jobs.filter((job) => job.status === 'running' || job.status === 'pending');
    
    if (runningJobs.length > 0) {
      // Start polling every 3 seconds for running jobs
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      
      const jobIds = runningJobs.map((job) => job.id);
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
  }, [jobs]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [dataResult, jobsResult] = await Promise.all([
        trainingApi.getData(),
        trainingApi.getJobs(),
      ]);
      setTrainingData(dataResult.trainingData);
      setJobs(jobsResult.jobs);
      
      // Load logs for running jobs
      const runningJobs = jobsResult.jobs.filter((job: any) => job.status === 'running' || job.status === 'pending');
      for (const job of runningJobs) {
        await loadJobLogs(job.id);
      }
    } catch (error) {
      logger.error('Failed to load training data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadJobLogs = async (jobId: string) => {
    try {
      const logsData = await trainingApi.getJobLogs(jobId);
      setJobLogs((prev) => ({
        ...prev,
        [jobId]: logsData,
      }));
    } catch (error) {
      logger.error('Failed to load job logs:', error);
    }
  };

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
    if (!confirm('Training jetzt starten?')) return;

    setTriggering(true);
    try {
      await trainingApi.triggerTraining();
      await loadData();
      alert('Training gestartet!');
    } catch (error: any) {
      logger.error('Failed to trigger training:', error);
      alert(error.response?.data?.message || 'Fehler beim Starten des Trainings');
    } finally {
      setTriggering(false);
    }
  };

  const handleDeleteTrainingData = async (id: string) => {
    if (!confirm('Möchten Sie diesen Eintrag wirklich löschen?')) return;

    try {
      await trainingApi.deleteTrainingData(id);
      await loadData();
    } catch (error: any) {
      logger.error('Failed to delete training data:', error);
      alert(error.response?.data?.message || 'Fehler beim Löschen');
    }
  };

  const handleEditTrainingData = (id: string, type: string) => {
    if (onEditTrainingData) {
      onEditTrainingData(id, type);
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
        <p className="mt-2 text-gray-600 dark:text-gray-400">Laden...</p>
      </div>
    );
  }

  const pendingCount = trainingData.filter((d) => d.status === 'pending').length;

  // Get training data IDs that are currently being used in running jobs
  const runningJobDataIds = new Set<string>();
  jobs
    .filter((job) => job.status === 'running' || job.status === 'pending')
    .forEach((job) => {
      if (job.trainingDataIds && Array.isArray(job.trainingDataIds)) {
        job.trainingDataIds.forEach((id: string) => runningJobDataIds.add(id));
      }
    });

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Training Data</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{trainingData.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">Pending</div>
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{pendingCount}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">Training Jobs</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{jobs.length}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Training starten
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {pendingCount >= 5
                ? `Bereit für Training (${pendingCount} Einträge)`
                : `Mindestens 5 Einträge benötigt (aktuell: ${pendingCount})`}
            </p>
          </div>
          <button
            onClick={handleTriggerTraining}
            disabled={triggering || pendingCount < 5}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggering ? 'Starte...' : 'Training starten'}
          </button>
        </div>
      </div>

      {/* Training Jobs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Training Jobs</h3>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {jobs.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              Noch keine Training Jobs
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
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                        {job.status}
                      </span>
                      {isRunning && (
                        <button
                          onClick={() => handleCancelTraining(job.id)}
                          disabled={cancelling === job.id}
                          className="px-3 py-1 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {cancelling === job.id ? 'Wird abgebrochen...' : 'Abbrechen'}
                        </button>
                      )}
                      <button
                        onClick={() => toggleJobExpanded(job.id)}
                        className="px-3 py-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                      >
                        {isExpanded ? 'Ausblenden' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar for running jobs */}
                  {isRunning && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {progress.phase}
                        </span>
                        <div className="flex items-center gap-2">
                          {progress.estimatedTimeRemaining !== undefined && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {formatEstimatedTime(progress.estimatedTimeRemaining)} verbleibend
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
                      Gestartet: {new Date(job.startedAt).toLocaleString()}
                    </div>
                  )}
                  {job.completedAt && (
                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                      Abgeschlossen: {new Date(job.completedAt).toLocaleString()}
                    </div>
                  )}

                  {/* Expanded Logs View */}
                  {isExpanded && logs && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                        Logs & Fortschritt
                      </h4>
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto">
                        {logs.logFileContent ? (
                          <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono">
                            {logs.logFileContent.split('\n').slice(-100).join('\n')}
                          </pre>
                        ) : logs.logs && logs.logs.length > 0 ? (
                          <div className="space-y-1">
                            {logs.logs.map((log: any, index: number) => (
                              <div
                                key={index}
                                className={`text-xs font-mono ${
                                  log.level === 'error'
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
                            Noch keine Logs verfügbar
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

      {/* Training Data */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Training Data</h3>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {trainingData.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              Noch keine Training Data
            </div>
          ) : (
            trainingData.map((data) => {
              const isInUse = runningJobDataIds.has(data.id);
              const canEdit = data.status === 'pending' && !isInUse;
              
              return (
                <div key={data.id} className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">{data.type}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(data.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {isInUse && (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400">
                          Wird trainiert
                        </span>
                      )}
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(data.status)}`}>
                        {data.status}
                      </span>
                      {canEdit && (
                        <>
                          {onEditTrainingData && (
                            <button
                              onClick={() => handleEditTrainingData(data.id, data.type)}
                              className="px-3 py-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                            >
                              Bearbeiten
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteTrainingData(data.id)}
                            className="px-3 py-1 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                          >
                            Löschen
                          </button>
                        </>
                      )}
                      {!canEdit && data.status === 'pending' && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                          Wird für Training verwendet
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

