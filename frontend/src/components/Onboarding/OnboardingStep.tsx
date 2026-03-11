import { Link } from "react-router-dom";

interface OnboardingStepProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  linkTo?: string;
  linkText?: string;
  onAction?: () => void;
}

export default function OnboardingStep({
  id,
  checked,
  onChange,
  label,
  description,
  linkTo,
  linkText,
  onAction,
}: OnboardingStepProps): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="checkbox mt-1"
      />
      <div className="flex-1">
        <label
          htmlFor={id}
          className="text-sm font-medium text-[var(--text-primary)] cursor-pointer"
        >
          {label}
        </label>
        {description && <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>}
        {onAction && linkText && (
          <button
            onClick={onAction}
            className="text-xs hover:underline mt-1 inline-block"
            style={{ color: "var(--accent)" }}
          >
            {linkText} →
          </button>
        )}
        {!onAction && linkTo && linkText && (
          <Link
            to={linkTo}
            className="text-xs hover:underline mt-1 inline-block"
            style={{ color: "var(--accent)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {linkText} →
          </Link>
        )}
      </div>
    </div>
  );
}
