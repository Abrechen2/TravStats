import { format } from 'date-fns';
import InlineHelp from '../Help/InlineHelp';
import { useTranslation } from '../../hooks/useTranslation';
import type { ParserFeedbackEntry } from '../../lib/api';

export interface FeedbackStats {
  total: number;
  byProvider: Record<string, number>;
  bySourceType: Record<string, number>;
  avgQualityScore: number;
  commonIssues: Array<{ issue: string; count: number }>;
}

export interface FeedbackPayload {
  provider: string;
  sourceType: string;
  qualityScore: number;
  issues?: string[];
  parsedResult?: Record<string, unknown>;
  correctedResult?: Record<string, unknown>;
  userCorrections?: Array<{
    field: string;
    original: unknown;
    corrected: unknown;
  }>;
}

export interface FeedbackDetails {
  feedback: ParserFeedbackEntry[];
  total: number;
}

interface FeedbackAnalyticsProps {
  feedbackStats: FeedbackStats | null;
  feedbackDetails: FeedbackDetails | null;
  feedbackDays: number;
  selectedFeedbackId: string | null;
  onSetDays: (days: number) => void;
  onSelectFeedback: (id: string | null) => void;
}

export default function FeedbackAnalytics({
  feedbackStats,
  feedbackDetails,
  feedbackDays,
  selectedFeedbackId,
  onSetDays,
  onSelectFeedback,
}: FeedbackAnalyticsProps): JSX.Element {
  const { t } = useTranslation(['admin', 'common']);

  return (
    <div className="space-y-6">
      <InlineHelp
        title={t('admin:parserFeedbackHelp.helpTitle')}
        category="advanced"
        content={
          <div className="space-y-2">
            <p>
              {t('admin:parserFeedbackHelp.helpContent.description')}
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>{t('admin:parserFeedbackHelp.helpContent.statsTitle')}</strong> {t('admin:parserFeedbackHelp.helpContent.stats')}
              </li>
              <li>
                <strong>{t('admin:parserFeedbackHelp.helpContent.usageTitle')}</strong> {t('admin:parserFeedbackHelp.helpContent.usage')}
              </li>
            </ul>
          </div>
        }
      />
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
                onChange={(e) => onSetDays(Number(e.target.value))}
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
                          {type === 'email' ? 'Email' : 'Boarding Pass'}
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
                  {feedbackStats.commonIssues.map((issue: { issue: string; count: number }, index: number) => (
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
                  {feedbackDetails.feedback.map((entry: ParserFeedbackEntry) => {
                    const payload = entry.payload as unknown as FeedbackPayload;
                    return (
                      <div
                        key={entry.id}
                        className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        onClick={() => onSelectFeedback(entry.id)}
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

      {/* Feedback Details Modal */}
      {selectedFeedbackId && feedbackDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Feedback Details</h2>
              <button
                onClick={() => onSelectFeedback(null)}
                className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              {(() => {
                const feedback = feedbackDetails.feedback.find((f: ParserFeedbackEntry) => f.id === selectedFeedbackId);
                if (!feedback) return <p>Feedback not found</p>;
                const payload = feedback.payload as unknown as FeedbackPayload;
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
                          {payload.userCorrections.map((correction: { field: string; original: unknown; corrected: unknown }, i: number) => (
                            <div key={i} className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg">
                              <div className="font-medium text-gray-900 dark:text-white">{correction.field}</div>
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {String(correction.original)} &rarr; {String(correction.corrected)}
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
    </div>
  );
}
