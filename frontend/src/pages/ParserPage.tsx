import { useState } from "react";
import { trainingApi } from "../lib/api";
import type { TrainingUploadType } from "../lib/api/training";
import { apiErrorMachineCode } from "../lib/apiError";
import UploadTile from "../components/Parser/UploadTile";
import { logger } from "../lib/logger";
import { useAuthStore } from "../store/authStore";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import EmailAnnotation from "../components/Training/EmailAnnotation";
import BoardingPassAnnotation from "../components/Training/BoardingPassAnnotation";
import ParseLogStats from "../components/Training/ParseLogStats";
import TemplateStatusView from "../components/TemplateStatusView";
import MyTemplates from "../components/Parser/MyTemplates";
import DomainPicker from "../components/Parser/DomainPicker";
import type { WorkshopDomain } from "../shared/annotationLabels";
import type { TemplateDerivation } from "../lib/api/types";
import { useToastStore } from "../store/toastStore";
import { useTranslation } from "../hooks/useTranslation";

/** The codes a refused screenshot answers with (forgejo#309), each worded in DE/EN. */
const SCREENSHOT_UPLOAD_ERRORS: ReadonlySet<string> = new Set([
  "TRAINING_IMAGE_UNREADABLE",
  "TRAINING_IMAGE_NO_TEXT",
]);

type Tab = "annotate" | "my-templates" | "community" | "parse-logs";

export default function ParserPage(): JSX.Element {
  const { t } = useTranslation(["parser", "common"]);
  const user = useAuthStore((s) => s.user);
  const addToast = useToastStore((state) => state.addToast);
  const [activeTab, setActiveTab] = useState<Tab>("annotate");
  const [uploadedFile, setUploadedFile] = useState<{
    id: string;
    type: string;
    /** What the classifier said, kept so the picker can mark an override. */
    detected: WorkshopDomain;
  } | null>(null);
  /** The domain the annotation is FOR — the classifier's answer until the
   *  user corrects it (forgejo#124 phase 6). */
  const [domain, setDomain] = useState<WorkshopDomain>("flight");
  const handleFileUpload = async (file: File, type: TrainingUploadType): Promise<void> => {
    try {
      const result = await trainingApi.upload(file, type);
      // A boarding pass is a flight by construction; only mail is classified,
      // and an older server that sends no domain keeps the old behaviour.
      const detected = result.domain ?? "flight";
      setUploadedFile({ id: result.id, type: result.type, detected });
      setDomain(detected);
    } catch (error) {
      logger.error({ err: error }, "ParserPage: upload failed");
      // A screenshot the OCR could not read says so in the reader's language;
      // the server's English sentence never reaches the screen.
      const code = apiErrorMachineCode(error);
      addToast(
        "error",
        code && SCREENSHOT_UPLOAD_ERRORS.has(code)
          ? t(`parser:annotate.uploadErrors.${code}`)
          : t("parser:annotate.uploadError")
      );
    }
  };

  /**
   * What the workshop made of the annotation, kept HERE.
   *
   * The annotation view is unmounted by the same handler that receives this,
   * so a banner it owned would be mounted and dropped in one batch — measured
   * on the abstention note, which the user never saw: they landed on "My
   * templates" with no template and no reason, the silent nothing the
   * abstention exists to end (forgejo#124 phase 6).
   */
  const [derivation, setDerivation] = useState<TemplateDerivation | null>(null);

  const handleAnnotationComplete = (outcome?: TemplateDerivation): void => {
    setUploadedFile(null);
    setDerivation(outcome ?? null);
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
      <PageHeader title={t("parser:title")} meta={t("parser:description")} />
      <div>
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

        {/* What the workshop made of the last annotation. It outlives the
            annotation view on purpose — see `derivation` above. */}
        {derivation && derivation.status !== "failed" && (
          <div
            role="status"
            className="mb-6 p-4 flex items-start justify-between gap-4"
            style={{
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
              borderRadius: "var(--ts-radius-card)",
              color: derivation.status === "derived" ? "var(--ts-text)" : "var(--warning)",
            }}
          >
            <p className="text-sm">
              {derivation.status === "derived"
                ? t("parser:workshop.derivedBanner")
                : t(`parser:derivation.cannot.${derivation.reason}`)}
            </p>
            <button
              type="button"
              onClick={() => setDerivation(null)}
              className="text-sm shrink-0"
              style={{ color: "var(--ts-muted)" }}
            >
              {t("parser:workshop.dismiss")}
            </button>
          </div>
        )}

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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <UploadTile
                    accept=".eml,.msg,.txt"
                    icon="mail"
                    title={t("parser:annotate.emailButton")}
                    formats={t("parser:annotate.emailFormats")}
                    onFile={(file) => void handleFileUpload(file, "email")}
                  />
                  <UploadTile
                    accept=".png,.jpg,.jpeg,.webp"
                    icon="image"
                    title={t("parser:annotate.boardingPassButton")}
                    formats={t("parser:annotate.boardingPassFormats")}
                    onFile={(file) => void handleFileUpload(file, "boarding_pass")}
                  />
                  <UploadTile
                    accept="image/png,image/jpeg,image/webp"
                    icon="image"
                    title={t("parser:annotate.screenshotButton")}
                    formats={t("parser:annotate.screenshotFormats")}
                    onFile={(file) => void handleFileUpload(file, "screenshot")}
                  />
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <button onClick={handleCancel} className="btn-secondary">
                    ← {t("common:buttons.cancel")}
                  </button>
                </div>
                {uploadedFile.type !== "boarding_pass" ? (
                  <div className="space-y-4">
                    <DomainPicker
                      value={domain}
                      detected={uploadedFile.detected}
                      onChange={setDomain}
                    />
                    <EmailAnnotation
                      trainingDataId={uploadedFile.id}
                      domain={domain}
                      onComplete={handleAnnotationComplete}
                      onCancel={handleCancel}
                    />
                  </div>
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
