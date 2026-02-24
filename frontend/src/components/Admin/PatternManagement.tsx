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
      <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("admin:patterns.title")}
          </h2>
          <div className="flex items-center gap-4">
            <button
              onClick={onAutoApply}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
            >
              {t("admin:patterns.autoApply")}
            </button>
            <label className="text-sm text-[var(--text-muted)]">
              {t("admin:patterns.timePeriod")}
              <select
                value={feedbackDays}
                onChange={(e) => onSetDays(Number(e.target.value))}
                className="ml-2 px-3 py-1 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)]"
              >
                <option value={7}>{t("admin:patterns.days7")}</option>
                <option value={30}>{t("admin:patterns.days30")}</option>
                <option value={90}>{t("admin:patterns.days90")}</option>
                <option value={365}>{t("admin:patterns.year")}</option>
              </select>
            </label>
          </div>
        </div>

        {patternData ? (
          <div className="space-y-6">
            {/* Statistics */}
            {patternData.stats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <div className="text-blue-600 text-sm font-medium mb-1">
                    {t("admin:patterns.totalPatterns")}
                  </div>
                  <div className="text-2xl font-bold text-blue-900">{patternData.stats.total}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <div className="text-green-600 text-sm font-medium mb-1">
                    {t("admin:patterns.applied")}
                  </div>
                  <div className="text-2xl font-bold text-green-900">
                    {patternData.stats.applied}
                  </div>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                  <div className="text-yellow-600 text-sm font-medium mb-1">
                    {t("admin:patterns.pending")}
                  </div>
                  <div className="text-2xl font-bold text-yellow-900">
                    {patternData.stats.pending}
                  </div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                  <div className="text-purple-600 text-sm font-medium mb-1">
                    {t("admin:patterns.avgConfidence")}
                  </div>
                  <div className="text-2xl font-bold text-purple-900">
                    {Math.round(patternData.stats.avgConfidence * 100)}%
                  </div>
                </div>
              </div>
            )}

            {/* Pending Suggestions */}
            <div className="bg-[var(--bg-base)] rounded-lg p-6">
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                {t("admin:patterns.pendingSuggestions", {
                  count: patternData.pendingSuggestions?.length || 0,
                })}
              </h3>
              {patternData.pendingSuggestions && patternData.pendingSuggestions.length > 0 ? (
                <div className="space-y-4">
                  {patternData.pendingSuggestions.map((suggestion: PatternSuggestion) => (
                    <div
                      key={suggestion.id}
                      className="bg-[var(--bg-surface)] rounded-lg p-4 border border-[var(--color-border)]"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm font-medium">
                              {suggestion.field}
                            </span>
                            <span
                              className={`px-2 py-1 rounded text-sm font-medium ${
                                suggestion.confidence >= 0.9
                                  ? "bg-green-100 text-green-800"
                                  : suggestion.confidence >= 0.8
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                              }`}
                            >
                              {t("admin:patterns.confidence", {
                                pct: Math.round(suggestion.confidence * 100),
                              })}
                            </span>
                          </div>
                          <div className="mb-2">
                            <span className="text-sm text-[var(--text-muted)]">
                              {t("admin:patterns.pattern")}{" "}
                            </span>
                            <code className="px-2 py-1 bg-[var(--bg-elevated)] rounded text-sm font-mono">
                              {suggestion.pattern}
                            </code>
                          </div>
                          <div className="mb-2">
                            <span className="text-sm text-[var(--text-muted)]">
                              {t("admin:patterns.issue")}{" "}
                            </span>
                            <span className="text-sm text-[var(--text-primary)]">
                              {suggestion.issue}
                            </span>
                          </div>
                          {suggestion.examples && suggestion.examples.length > 0 && (
                            <div>
                              <span className="text-sm text-[var(--text-muted)]">
                                {t("admin:patterns.examples")}{" "}
                              </span>
                              <span className="text-sm text-[var(--text-primary)]">
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
                          {t("admin:patterns.apply")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--text-muted)]">{t("admin:patterns.noPending")}</p>
              )}
            </div>

            {/* Summary */}
            {patternData.summary && (
              <div className="bg-[var(--bg-base)] rounded-lg p-6">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                  {t("admin:patterns.summary")}
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">
                      {t("admin:patterns.totalIssues")}
                    </span>
                    <span className="font-medium text-[var(--text-primary)]">
                      {patternData.summary.totalIssues}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">
                      {t("admin:patterns.patternSuggestions")}
                    </span>
                    <span className="font-medium text-[var(--text-primary)]">
                      {patternData.summary.suggestions}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-[var(--text-muted)] mb-2">{t("admin:patterns.loading")}</div>
          </div>
        )}
      </div>

      {/* Pattern Apply Confirmation Modal */}
      {showPatternConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-surface)] rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-4">
              {t("admin:patterns.confirmApply.title")}
            </h3>
            <p className="text-[var(--text-primary)] mb-6">
              {t("admin:patterns.confirmApply.message")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={onDismissConfirm}
                className="flex-1 px-4 py-2 bg-[var(--bg-muted)] text-[var(--text-primary)] rounded-lg font-medium hover:bg-[var(--bg-elevated)] transition-colors"
              >
                {t("admin:patterns.confirmApply.cancel")}
              </button>
              <button
                onClick={onApplyConfirm}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                {t("admin:patterns.confirmApply.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto Apply Patterns Confirmation Modal */}
      {showAutoApplyConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-surface)] rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-4">
              {t("admin:patterns.confirmAutoApply.title")}
            </h3>
            <p className="text-[var(--text-primary)] mb-6">
              {t("admin:patterns.confirmAutoApply.message")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={onDismissAutoApply}
                className="flex-1 px-4 py-2 bg-[var(--bg-muted)] text-[var(--text-primary)] rounded-lg font-medium hover:bg-[var(--bg-elevated)] transition-colors"
              >
                {t("admin:patterns.confirmAutoApply.cancel")}
              </button>
              <button
                onClick={onAutoApplyConfirm}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                {t("admin:patterns.confirmAutoApply.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
