import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

export interface PatternSuggestion {
  id: string;
  pattern: string;
  field: string;
  confidence: number;
  examples: string[];
  issue: string;
}

export interface PatternData {
  suggestions: PatternSuggestion[];
  summary: {
    totalIssues: number;
    suggestions: number;
    topIssues: Array<{ issue: string; count: number }>;
  };
  pendingSuggestions: PatternSuggestion[];
  stats: {
    total: number;
    applied: number;
    pending: number;
    avgConfidence: number;
    byField: Record<string, number>;
  };
}

interface PatternManagementProps {
  patternData: PatternData | null;
  feedbackDays: number;
  showPatternConfirm: string | null;
  showAutoApplyConfirm: boolean;
  onSetDays: (days: number) => void;
  onApply: (eventId: string) => void;
  onApplyConfirm: () => void;
  onAutoApply: () => void;
  onAutoApplyConfirm: () => void;
  onDismissConfirm: () => void;
  onDismissAutoApply: () => void;
}

export default function PatternManagement({
  patternData,
  feedbackDays,
  showPatternConfirm,
  showAutoApplyConfirm,
  onSetDays,
  onApply,
  onApplyConfirm,
  onAutoApply,
  onAutoApplyConfirm,
  onDismissConfirm,
  onDismissAutoApply,
}: PatternManagementProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-6">
      <InlineHelp
        title={t("admin:patternUpdatesHelp.helpTitle")}
        category="expert"
        content={
          <div className="space-y-2">
            <p>{t("admin:patternUpdatesHelp.helpContent.description")}</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>{t("admin:patternUpdatesHelp.helpContent.suggestionsTitle")}</strong>{" "}
                {t("admin:patternUpdatesHelp.helpContent.suggestions")}
              </li>
              <li>
                <strong>{t("admin:patternUpdatesHelp.helpContent.autoApplyTitle")}</strong>{" "}
                {t("admin:patternUpdatesHelp.helpContent.autoApply")}
              </li>
            </ul>
          </div>
        }
      />
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Pattern Updates &amp; Suggestions
          </h2>
          <div className="flex items-center gap-4">
            <button
              onClick={onAutoApply}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
            >
              Auto-Apply High Confidence (&ge;90%)
            </button>
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
                  {patternData.pendingSuggestions.map((suggestion: PatternSuggestion) => (
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
                            <span
                              className={`px-2 py-1 rounded text-sm font-medium ${
                                suggestion.confidence >= 0.9
                                  ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                                  : suggestion.confidence >= 0.8
                                    ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300"
                                    : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                              }`}
                            >
                              {Math.round(suggestion.confidence * 100)}% confidence
                            </span>
                          </div>
                          <div className="mb-2">
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              Pattern:{" "}
                            </span>
                            <code className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-sm font-mono">
                              {suggestion.pattern}
                            </code>
                          </div>
                          <div className="mb-2">
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              Issue:{" "}
                            </span>
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {suggestion.issue}
                            </span>
                          </div>
                          {suggestion.examples && suggestion.examples.length > 0 && (
                            <div>
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                Examples:{" "}
                              </span>
                              <span className="text-sm text-gray-700 dark:text-gray-300">
                                {suggestion.examples.slice(0, 5).join(", ")}
                                {suggestion.examples.length > 5 &&
                                  ` (+${suggestion.examples.length - 5} more)`}
                              </span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onApply(suggestion.id)}
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
                    <span className="font-medium text-gray-900 dark:text-white">
                      {patternData.summary.totalIssues}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Pattern Suggestions:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {patternData.summary.suggestions}
                    </span>
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

      {/* Pattern Apply Confirmation Modal */}
      {showPatternConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Pattern anwenden?
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Möchten Sie dieses Pattern wirklich anwenden? Hinweis: Dies erfordert manuelle
              Code-Updates.
            </p>
            <div className="flex gap-3">
              <button
                onClick={onDismissConfirm}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={onApplyConfirm}
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
              Möchten Sie alle hochwertigen Patterns automatisch anwenden? Dies kann mehrere
              Patterns gleichzeitig betreffen.
            </p>
            <div className="flex gap-3">
              <button
                onClick={onDismissAutoApply}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={onAutoApplyConfirm}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Anwenden
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
