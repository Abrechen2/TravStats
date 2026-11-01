import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";

/** What the workshop receives through the router's location state. */
export interface WorkshopHandoff {
  workshopDocument: File;
}

/** The handed-over document, or null when the location carries none. */
export function workshopDocumentOf(state: unknown): File | null {
  const doc = (state as Partial<WorkshopHandoff> | null | undefined)?.workshopDocument;
  return doc instanceof File ? doc : null;
}

/**
 * "Not recognised? Create a template for it" (forgejo#330): the way from a
 * document that no parser read to the workshop, with that document already
 * loaded there. The file travels in memory through the router state; nothing
 * is uploaded until the workshop page does it. Pasted text becomes a `.txt`.
 */
export default function WorkshopJumpLink({
  file,
  text,
}: {
  file?: File | null;
  text?: string;
}): JSX.Element | null {
  const { t } = useTranslation(["parser"]);
  const navigate = useNavigate();
  const document_ =
    file ??
    (text && text.trim()
      ? new File([text], t("parser:handoff.textName"), { type: "text/plain" })
      : null);
  // The workshop reads mail files and screenshots; a PDF has no text there yet.
  if (!document_ || /\.pdf$/i.test(document_.name) || document_.type === "application/pdf") {
    return null;
  }
  return (
    <p className="t-caption">
      <button
        type="button"
        className="underline"
        style={{ color: "var(--ts-accent)" }}
        onClick={() =>
          navigate("/parser", { state: { workshopDocument: document_ } satisfies WorkshopHandoff })
        }
      >
        {t("parser:handoff.link")}
      </button>{" "}
      {t("parser:handoff.hint")}
    </p>
  );
}
