import { useState, useEffect } from "react";
import { trainingApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

interface TrainingDataPreviewProps {
  trainingDataId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function TrainingDataPreview({
  trainingDataId,
  isOpen,
  onClose,
}: TrainingDataPreviewProps): JSX.Element | null {
  const { t } = useTranslation("training");
  const [data, setData] = useState<{
    type: string;
    status: string;
    createdAt: string;
    trainedAt?: string;
    tags?: string[];
    annotations?: Record<string, unknown>;
    extractedData?: unknown[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && trainingDataId) {
      loadData();
    }
  }, [isOpen, trainingDataId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const trainingData = await trainingApi.getById(trainingDataId);
      setData(trainingData);
    } catch (error) {
      logger.error("Failed to load training data:", error);
      alert(t("training:errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-[var(--bg-base)]0 bg-opacity-75"
          onClick={onClose}
        ></div>

        {/* Center modal */}
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
          &#8203;
        </span>

        <div className="inline-block align-bottom bg-[var(--bg-surface)] rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          <div className="bg-[var(--bg-surface)] px-4 pt-5 pb-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg leading-6 font-medium text-[var(--text-primary)]">
                {t("training:preview.title")}
              </h3>
              <button
                onClick={onClose}
                className="text-[var(--text-muted)] hover:text-[var(--text-muted)]"
              >
                <span className="sr-only">{t("training:preview.closeAria")}</span>
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
                <p className="mt-2 text-[var(--text-muted)]">{t("training:preview.loading")}</p>
              </div>
            ) : data ? (
              <div className="space-y-6">
                {/* Basic Info */}
                <div>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                    {t("training:preview.basicInfo")}
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--text-muted)]">
                        {t("training:preview.type")}:
                      </span>{" "}
                      <span className="text-[var(--text-primary)]">{data.type}</span>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)]">
                        {t("training:preview.status")}:
                      </span>{" "}
                      <span className="text-[var(--text-primary)]">{data.status}</span>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)]">
                        {t("training:preview.created")}:
                      </span>{" "}
                      <span className="text-[var(--text-primary)]">
                        {new Date(data.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {data.trainedAt && (
                      <div>
                        <span className="text-[var(--text-muted)]">
                          {t("training:preview.trained")}:
                        </span>{" "}
                        <span className="text-[var(--text-primary)]">
                          {new Date(data.trainedAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tags */}
                {data.tags && data.tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                      {t("training:preview.tags")}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {data.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Annotations */}
                {data.annotations && (
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                      {t("training:preview.annotations")}
                    </h4>
                    <div className="bg-[var(--bg-base)] rounded-lg p-4 max-h-64 overflow-y-auto">
                      <pre className="text-xs text-[var(--text-primary)] whitespace-pre-wrap font-mono">
                        {JSON.stringify(data.annotations, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Extracted Data */}
                {data.extractedData &&
                  Array.isArray(data.extractedData) &&
                  data.extractedData.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                        {t("training:preview.extractedDataCount", {
                          count: data.extractedData.length,
                        })}
                      </h4>
                      <div className="bg-[var(--bg-base)] rounded-lg p-4 max-h-64 overflow-y-auto">
                        <pre className="text-xs text-[var(--text-primary)] whitespace-pre-wrap font-mono">
                          {JSON.stringify(data.extractedData, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text-muted)]">
                {t("training:preview.noDataAvailable")}
              </div>
            )}
          </div>
          <div className="bg-[var(--bg-base)] px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={onClose}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 sm:ml-3 sm:w-auto sm:text-sm"
            >
              {t("training:preview.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
