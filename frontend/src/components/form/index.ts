/**
 * The shared form building blocks (forgejo#245–#250), in one import for the
 * per-domain rollout. Each module documents the defect it exists for.
 */
export { useDirtyGuard } from "./useDirtyGuard";
export { useDiscardGuard } from "./useDiscardGuard";
export { RequiredMark, focusFirstMissingRequired, unfoldAncestors } from "./requiredFields";
export { default as RequiredLegend } from "./RequiredLegend";
export { default as SaveBlockedHint } from "./SaveBlockedHint";
export type { MissingStep } from "./SaveBlockedHint";
export { fieldErrorProps, fieldErrorId } from "./fieldErrorProps";
export { default as FieldError } from "./FieldError";
export { default as FormErrorBanner } from "./FormErrorBanner";
export { focusFirstError } from "./focusFirstError";
export { useSaveOnce } from "./useSaveOnce";
export type { SaveOutcome } from "./useSaveOnce";
/**
 * The help affordance for a field (forgejo#249): a real button, so it opens on
 * a tap and from the keyboard, with `aria-expanded` and Escape — never a
 * `title` that only a mouse can reach.
 */
export { default as HelpIcon } from "../Help/HelpIcon";
