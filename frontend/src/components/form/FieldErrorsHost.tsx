import { useEffect, useState } from "react";
import type { JSX } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../hooks/useTranslation";
import InlineError from "../ui/InlineError";
import { fieldErrorId } from "./fieldErrorProps";
import type { useFormFailure } from "./useFormFailure";

/**
 * Draws a refused body's field errors under their controls — the rc.47 rule
 * "a field error shows at the field", for the forms whose fields do not each
 * take an `error` prop. Put it anywhere inside the form root that
 * `failure.rootRef` marks; the controls are found by `findFieldControl`.
 *
 * Each control is told about its error (`aria-invalid`, `aria-describedby`),
 * which is also what `focusFirstError` looks for, and the message sits right
 * after it. Everything it touches is put back when the refusal goes away.
 */
export default function FieldErrorsHost({
  failure,
}: {
  failure: Pick<ReturnType<typeof useFormFailure>, "fieldErrors" | "rootRef">;
}): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  const [anchors, setAnchors] = useState<Array<{ id: string; node: HTMLElement; text: string }>>(
    []
  );
  const { fieldErrors, rootRef } = failure;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || fieldErrors.length === 0) {
      setAnchors((a) => (a.length === 0 ? a : []));
      return;
    }
    const made: Array<{ id: string; node: HTMLElement; text: string; undo: () => void }> = [];
    for (const e of fieldErrors) {
      const control = root.querySelector<HTMLElement>(`[id="${e.controlId}"]`);
      if (!control) continue;
      const node = document.createElement("div");
      control.insertAdjacentElement("afterend", node);
      const before = {
        invalid: control.getAttribute("aria-invalid"),
        described: control.getAttribute("aria-describedby"),
      };
      control.setAttribute("aria-invalid", "true");
      const errId = fieldErrorId(e.controlId);
      control.setAttribute(
        "aria-describedby",
        before.described ? `${before.described} ${errId}` : errId
      );
      made.push({
        id: e.controlId,
        node,
        text: t(
          e.kind === "required" ? "common:fieldErrors.required" : "common:fieldErrors.invalid"
        ),
        undo: (): void => {
          node.remove();
          if (before.invalid === null) control.removeAttribute("aria-invalid");
          else control.setAttribute("aria-invalid", before.invalid);
          if (before.described === null) control.removeAttribute("aria-describedby");
          else control.setAttribute("aria-describedby", before.described);
        },
      });
    }
    setAnchors(made.map(({ id, node, text }) => ({ id, node, text })));
    return (): void => made.forEach((m) => m.undo());
  }, [fieldErrors, rootRef, t]);

  return (
    <>
      {anchors.map((a) =>
        createPortal(
          <InlineError id={fieldErrorId(a.id)} testId="field-error">
            {a.text}
          </InlineError>,
          a.node,
          a.id
        )
      )}
    </>
  );
}
