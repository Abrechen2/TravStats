import { useTranslation } from "../../hooks/useTranslation";
import type { TemplatePreviewResult, TemplatePreviewSide } from "../../lib/api/types";

/**
 * What a derived template would read — before it is allowed to read anything.
 *
 * forgejo#124 phase 6. A template used to go straight to `active`, so the
 * first time a user saw its output was inside a real import, as a proposal
 * next to a save button. The two sides here are not decoration: the own
 * sample shows the patterns were copied out correctly, and the held-out mail
 * is the only evidence that the template describes a SENDER and not one
 * booking. A template that reads its own sample and nothing else is worth
 * knowing about before it is switched on, not after.
 */

interface TemplatePreviewPanelProps {
  preview: TemplatePreviewResult;
}

function Side({ side, title }: { side: TemplatePreviewSide | null; title: string }): JSX.Element {
  const { t } = useTranslation(["parser"]);
  return (
    <div>
      <div className="text-xs font-medium mb-1" style={{ color: "var(--text-primary)" }}>
        {title}
      </div>
      {!side || !side.result.matched ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("parser:preview.readNothing")}
        </p>
      ) : (
        <ul className="text-xs space-y-0.5">
          {side.result.fields.map((field) => (
            <li key={field.name} style={{ color: "var(--text-primary)" }}>
              <span style={{ color: "var(--text-muted)" }}>{field.name}: </span>
              {field.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TemplatePreviewPanel({ preview }: TemplatePreviewPanelProps): JSX.Element {
  const { t } = useTranslation(["parser"]);
  return (
    <div
      className="mt-3 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4"
      style={{ background: "var(--bg-base)", border: "1px solid var(--color-border)" }}
    >
      <Side side={preview.own} title={t("parser:preview.ownSample")} />
      {preview.heldOutReason === "noSecondSample" ? (
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: "var(--text-primary)" }}>
            {t("parser:preview.heldOutSample")}
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("parser:preview.noSecondSample")}
          </p>
        </div>
      ) : (
        <Side side={preview.heldOut} title={t("parser:preview.heldOutSample")} />
      )}
      <p
        className="text-xs md:col-span-2"
        style={{ color: preview.canActivate ? "var(--success)" : "var(--warning)" }}
      >
        {preview.canActivate ? t("parser:preview.canActivate") : t("parser:preview.cannotActivate")}
      </p>
    </div>
  );
}
