import { Icon } from "../ui/Icon";
import { useState, forwardRef } from "react";
import { useTranslation } from "../../hooks/useTranslation";

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visual variant: "input" uses the .input class, "label" expects a sibling .label */
  className?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = "input w-full", ...props }, ref): JSX.Element {
    const { t } = useTranslation("auth");
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        <input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          className={`${className} pr-10`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? t("login.hidePassword") : t("login.showPassword")}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center justify-center w-10 transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          {visible ? <Icon name="eye-off" size={18} /> : <Icon name="eye" size={18} />}
        </button>
      </div>
    );
  }
);
