import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { authApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";
import { LogoLockup } from "../components/Brand/Logo";

/**
 * Second step of a login. The challenge itself is an HttpOnly cookie set by
 * POST /auth/login, so this page holds no credential of its own — reloading it
 * is harmless, and it cannot be reached usefully without having just entered a
 * correct password.
 */
export default function TwoFactorChallengePage(): JSX.Element {
  const { t } = useTranslation(["auth"]);
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body = useRecovery ? { recoveryCode: value.trim() } : { code: value.trim() };
      const result = await authApi.verifyTwoFactor(body);
      setAuth(result.user);
      navigate("/");
    } catch {
      setError(t("auth:twoFactor.rejected"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative">
      <div className="auth-bg" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.35,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        }}
        className="relative z-10 w-full max-w-sm px-4"
      >
        <div className="flex flex-col items-center text-center mb-8 gap-3">
          <LogoLockup size={26} markSize={72} layout="stacked" />
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("auth:twoFactor.title")}
          </p>
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(28, 33, 40, 0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--color-border)",
            borderTop: "2px solid var(--accent)",
          }}
        >
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            {useRecovery ? t("auth:twoFactor.recoveryHint") : t("auth:twoFactor.hint")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="twofa-input"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {useRecovery ? t("auth:twoFactor.recoveryLabel") : t("auth:twoFactor.codeLabel")}
              </label>
              <input
                id="twofa-input"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="input w-full"
                // A password manager must not try to fill a recovery code into
                // the one-time-code field, so the hint changes with the mode.
                autoComplete={useRecovery ? "off" : "one-time-code"}
                inputMode={useRecovery ? "text" : "numeric"}
                required
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? t("auth:twoFactor.verifying") : t("auth:twoFactor.submit")}
            </button>
          </form>

          <button
            type="button"
            className="mt-4 text-sm underline cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onClick={() => {
              setUseRecovery((previous) => !previous);
              setValue("");
              setError("");
            }}
          >
            {useRecovery ? t("auth:twoFactor.useCode") : t("auth:twoFactor.useRecovery")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
