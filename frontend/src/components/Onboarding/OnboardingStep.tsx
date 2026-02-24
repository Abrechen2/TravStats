import { Link } from "react-router-dom";

interface OnboardingStepProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  linkTo?: string;
  linkText?: string;
}

export default function OnboardingStep({
  id,
  checked,
  onChange,
  label,
  description,
  linkTo,
  linkText,
}: OnboardingStepProps): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-blue-600 focus:ring-blue-500"
      />
      <div className="flex-1">
        <label
          htmlFor={id}
          className="text-sm font-medium text-[var(--text-primary)] cursor-pointer"
        >
          {label}
        </label>
        {description && <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>}
        {linkTo && linkText && (
          <Link
            to={linkTo}
            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
            onClick={(e) => e.stopPropagation()}
          >
            {linkText} {"→"}
          </Link>
        )}
      </div>
    </div>
  );
}
