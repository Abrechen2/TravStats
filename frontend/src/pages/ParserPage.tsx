import { useState, useRef } from "react";
import { trainingApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useAuthStore } from "../store/authStore";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import Pill from "../components/ui/Pill";
import EmailAnnotation from "../components/Training/EmailAnnotation";
import BoardingPassAnnotation from "../components/Training/BoardingPassAnnotation";
import ParseLogStats from "../components/Training/ParseLogStats";
import TemplateStatusView from "../components/TemplateStatusView";
import MyTemplates from "../components/Parser/MyTemplates";
import { useToastStore } from "../store/toastStore";
import { useTranslation } from "../hooks/useTranslation";
import { Icon } from "../components/ui/Icon";

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
    <AppShell width="list">
      <PageHeader
        title={t("parser:title")}
        meta={t("parser:description")}
        actions={
          <Pill color="var(--ts-warn)" title={t("parser:betaNotice")}>
            {t("parser:beta")}
          </Pill>
        }
      />
      <div>
        {/* Beta notice */}
        <div
          className="mb-4 rounded-[var(--ts-radius-card)] px-4 py-3"
          style={{
            border: "1px solid color-mix(in srgb, var(--ts-warn) 35%, transparent)",
            background: "color-mix(in srgb, var(--ts-warn) 8%, transparent)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--ts-warn)" }}>
            {t("parser:betaNotice")}
          </p>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          className="mb-6 flex overflow-x-auto scrollbar-none"
          style={{ borderBottom: "1px solid var(--ts-border)" }}
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className="shrink-0 whitespace-nowrap px-4 py-3 text-sm"
                style={{
                  fontWeight: active ? 700 : 500,
                  color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                  boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab: Annotieren */}
        {activeTab === "annotate" && (
          <div className="space-y-6">
            {!uploadedFile ? (
              <div
                className="p-6"
                style={{
                  background: "var(--ts-surface)",
                  border: "1px solid var(--ts-border)",
                  borderRadius: "var(--ts-radius-card)",
                }}
              >
                <h2
                  className="mb-1"
                  style={{ fontSize: 17, fontWeight: 700, color: "var(--ts-text-bright)" }}
                >
                  {t("parser:annotate.title")}
                </h2>
                <p className="t-caption mb-5">{t("parser:annotate.description")}</p>
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
                      className="flex w-full flex-col items-center gap-2 rounded-[var(--ts-radius-card)] border border-dashed border-[var(--ts-border)] p-6 text-center transition-colors hover:border-[var(--ts-accent)]"
                    >
                      <span style={{ color: "var(--ts-accent)" }}>
                        <Icon name="mail" size={24} />
                      </span>
                      <div style={{ fontWeight: 700, color: "var(--ts-text-bright)" }}>
                        {t("parser:annotate.emailButton")}
                      </div>
                      <div className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
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
                      className="flex w-full flex-col items-center gap-2 rounded-[var(--ts-radius-card)] border border-dashed border-[var(--ts-border)] p-6 text-center transition-colors hover:border-[var(--ts-accent)]"
                    >
                      <span style={{ color: "var(--ts-accent)" }}>
                        <Icon name="image" size={24} />
                      </span>
                      <div style={{ fontWeight: 700, color: "var(--ts-text-bright)" }}>
                        {t("parser:annotate.boardingPassButton")}
                      </div>
                      <div className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
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
          <div
            className="p-6"
            style={{
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
              borderRadius: "var(--ts-radius-card)",
            }}
          >
            <h2 className="text-xl font-semibold text-(--text-primary) mb-1">
              {t("parser:communityTemplates.title")}
            </h2>
            <p className="t-caption mb-5">{t("parser:communityTemplates.description")}</p>
            <TemplateStatusView />
          </div>
        )}

        {/* Tab: Parse-Logs (Admin only) */}
        {activeTab === "parse-logs" && user?.isAdmin && (
          <div className="p-4">
            <ParseLogStats />
          </div>
        )}
      </div>
    </AppShell>
  );
}
