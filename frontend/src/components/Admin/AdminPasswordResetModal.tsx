import { useState } from "react";
import { motion } from "framer-motion";
import { adminApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { copyToClipboard } from "../../lib/clipboard";

interface AdminPasswordResetModalProps {
  userId: string;
  username: string;
  onClose: () => void;
}

type TabType = "generate" | "set";

export default function AdminPasswordResetModal({
  userId,
  username,
  onClose,
}: AdminPasswordResetModalProps): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [activeTab, setActiveTab] = useState<TabType>("generate");

  // Generate tab state
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [generateMustChange, setGenerateMustChange] = useState(true);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Set tab state
  const [newPassword, setNewPassword] = useState("");
  const [setMustChange, setSetMustChange] = useState(false);
  const [setLoading, setSetLoading] = useState(false);
  const [setSuccess, setSetSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async (): Promise<void> => {
    setError("");
    setGenerateLoading(true);
    try {
      const result = await adminApi.adminResetPassword(
        userId,
        "generate",
        undefined,
        generateMustChange
      );
      setGeneratedPassword(result.temporaryPassword ?? "");
    } catch {
      setError("Reset failed. Please try again.");
    } finally {
      setGenerateLoading(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    try {
      await copyToClipboard(generatedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — UI stays in its current state
    }
  };

  const handleSet = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setSetLoading(true);
    try {
      await adminApi.adminResetPassword(userId, "set", newPassword, setMustChange);
      setSetSuccess(true);
    } catch {
      setError("Reset failed. Please try again.");
    } finally {
      setSetLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl p-6"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          {t("admin:users.resetPasswordModal.title")} — {username}
        </h2>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(["generate", "set"] as TabType[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab);
                setError("");
              }}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-(--accent) text-(--bg-base)"
                  : "bg-(--bg-elevated) text-(--text-muted) hover:text-(--text-primary)"
              }`}
            >
              {t(`admin:users.resetPasswordModal.tabs.${tab}`)}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {activeTab === "generate" && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("admin:users.resetPasswordModal.generate.description")}
            </p>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={generateMustChange}
                onChange={(e) => setGenerateMustChange(e.target.checked)}
                className="rounded-sm"
              />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {t("admin:users.resetPasswordModal.generate.mustChange")}
              </span>
            </label>

            {generatedPassword ? (
              <div className="space-y-2">
                <div
                  className="rounded-lg p-3 flex items-center justify-between gap-2"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  <code className="text-sm font-mono" style={{ color: "var(--text-primary)" }}>
                    {generatedPassword}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="text-xs px-3 py-1 rounded-sm btn-secondary shrink-0"
                  >
                    {copied
                      ? t("admin:users.resetPasswordModal.generate.copied")
                      : t("admin:users.resetPasswordModal.generate.copy")}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setGeneratedPassword("")}
                  className="text-xs w-full text-center hover:underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("admin:users.resetPasswordModal.generate.regenerate")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generateLoading}
                className="btn-primary w-full py-2"
              >
                {generateLoading
                  ? t("admin:users.resetPasswordModal.generate.generating")
                  : t("admin:users.resetPasswordModal.generate.button")}
              </button>
            )}
          </div>
        )}

        {activeTab === "set" && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("admin:users.resetPasswordModal.set.description")}
            </p>

            {setSuccess ? (
              <p className="text-sm text-green-400">
                {t("admin:users.resetPasswordModal.success")}
              </p>
            ) : (
              <form onSubmit={handleSet} className="space-y-4">
                <div>
                  <label
                    htmlFor="adminNewPassword"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {t("admin:users.resetPasswordModal.set.passwordLabel")}
                  </label>
                  <input
                    id="adminNewPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input w-full"
                    minLength={8}
                    required
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setMustChange}
                    onChange={(e) => setSetMustChange(e.target.checked)}
                    className="rounded-sm"
                  />
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {t("admin:users.resetPasswordModal.set.mustChange")}
                  </span>
                </label>

                <button type="submit" disabled={setLoading} className="btn-primary w-full py-2">
                  {setLoading
                    ? t("admin:users.resetPasswordModal.set.submitting")
                    : t("admin:users.resetPasswordModal.set.submit")}
                </button>
              </form>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full text-sm hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          {t("admin:users.resetPasswordModal.close")}
        </button>
      </motion.div>
    </motion.div>
  );
}
