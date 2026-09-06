import { useState, useRef } from "react";
import { trainingApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useAuthStore } from "../store/authStore";
import NavigationBar from "../components/NavigationBar";
import EmailAnnotation from "../components/Training/EmailAnnotation";
import BoardingPassAnnotation from "../components/Training/BoardingPassAnnotation";
import ParseLogStats from "../components/Training/ParseLogStats";
import TemplateStatusView from "../components/TemplateStatusView";
import MyTemplates from "../components/Parser/MyTemplates";
import { useToastStore } from "../store/toastStore";
import { useTranslation } from "../hooks/useTranslation";

type Tab = "annotate" | "my-templates" | "community" | "parse-logs";

export default function ParserPage(): JSX.Element {
  const { t } = useTranslation(["parser", "common"]);
  const user = useAuthStore((s) => s.user);
  const addToast = useToastStore((state) => state.addToast);
  const [activeTab, setActiveTab] = useState<Tab>("annotate");
  const [uploadedFile, setUploadedFile] = useState<{ id: string; type: string } | null>(null);
  const emailFileInputRef = useRef<HTMLInputElement>(null);
  const boardingPassFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File, type: "email" | "boarding_pass"): Promise<void> => {
    try {
      const result = await trainingApi.upload(file, type);
      setUploadedFile({ id: result.id, type: result.type });
    } catch (error) {
      logger.error({ err: error }, "ParserPage: upload failed");
      addToast("error", t("parser:annotate.uploadError"));
    }
  };

  const handleAnnotationComplete = (): void => {
    setUploadedFile(null);
    setActiveTab("my-templates");
  };

  const handleCancel = (): void => {
    setUploadedFile(null);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "annotate", label: t("parser:tabs.annotate") },
    { id: "my-templates", label: t("parser:tabs.myTemplates") },
    { id: "community", label: t("parser:tabs.communityTemplates") },
    ...(user?.isAdmin ? [{ id: "parse-logs" as Tab, label: t("parser:tabs.parseLogs") }] : []),
  ];

  return (
    <div className="min-h-screen bg-(--bg-base)">
      <NavigationBar />
      <header className="bg-(--bg-elevated) border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="t-screen-title">
              {t("parser:title")}
            </h1>
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20">
              {t("parser:beta")}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("parser:description")}</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Beta notice */}
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm text-amber-800 dark:text-amber-300">{t("parser:betaNotice")}</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-6 sm:gap-8 overflow-x-auto overflow-y-hidden whitespace-nowrap">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="py-4 px-1 border-b-2 font-medium text-sm transition-colors"
                style={
                  activeTab === tab.id
                    ? { borderColor: "var(--accent)", color: "var(--accent)" }
                    : { borderColor: "transparent", color: "var(--text-muted)" }
                }
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab: Annotieren */}
        {activeTab === "annotate" && (
          <div className="space-y-6">
            {!uploadedFile ? (
              <div className="bg-(--bg-elevated) rounded-lg shadow-sm p-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  {t("parser:annotate.title")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                  {t("parser:annotate.description")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <input
                      ref={emailFileInputRef}
                      type="file"
                      accept=".eml,.msg,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFileUpload(file, "email");
                      }}
                    />
                    <button
                      onClick={() => emailFileInputRef.current?.click()}
                      className="w-full p-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-center"
                    >
                      <div className="text-4xl mb-2">📧</div>
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {t("parser:annotate.emailButton")}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {t("parser:annotate.emailFormats")}
                      </div>
                    </button>
                  </div>
                  <div>
                    <input
                      ref={boardingPassFileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFileUpload(file, "boarding_pass");
                      }}
                    />
                    <button
                      onClick={() => boardingPassFileInputRef.current?.click()}
                      className="w-full p-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-center"
                    >
                      <div className="text-4xl mb-2">🎫</div>
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {t("parser:annotate.boardingPassButton")}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {t("parser:annotate.boardingPassFormats")}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <button onClick={handleCancel} className="btn-secondary">
                    ← {t("common:buttons.cancel")}
                  </button>
                </div>
                {uploadedFile.type === "email" ? (
                  <EmailAnnotation
                    trainingDataId={uploadedFile.id}
                    onComplete={handleAnnotationComplete}
                    onCancel={handleCancel}
                  />
                ) : (
                  <BoardingPassAnnotation
                    trainingDataId={uploadedFile.id}
                    onComplete={handleAnnotationComplete}
                    onCancel={handleCancel}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab: Meine Templates */}
        {activeTab === "my-templates" && <MyTemplates />}

        {/* Tab: Community Templates */}
        {activeTab === "community" && (
          <div className="bg-(--bg-elevated) rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
              {t("parser:communityTemplates.title")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {t("parser:communityTemplates.description")}
            </p>
            <TemplateStatusView />
          </div>
        )}

        {/* Tab: Parse-Logs (Admin only) */}
        {activeTab === "parse-logs" && user?.isAdmin && (
          <div className="p-4">
            <ParseLogStats />
          </div>
        )}
      </main>
    </div>
  );
}
