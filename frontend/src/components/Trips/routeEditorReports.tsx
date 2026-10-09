import { useCallback, useState } from "react";
import type { JSX } from "react";

import { FormErrorBanner } from "../form";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";

/**
 * The route editor's sections say what happened to them IN them (forgejo#246,
 * forgejo#247). Until 2.7 every failure on this page — an assignment the
 * server refused, a leg that could not be routed, a recording that would not
 * upload — was a toast: gone after a few seconds, naming no section, while the
 * switch it was about had silently flipped back. A report here stays until the
 * next action in its section, says which section it belongs to by where it is,
 * and carries a retry where retrying can help.
 *
 * `notice` is the other half of #247: a partly successful action ("3 legs
 * routed, 1 stayed straight") is news, not an error, and must not disappear
 * either.
 */
export type RouteEditorSection = "header" | "points" | "stops" | "legs" | "tracks";

export interface RouteEditorReport {
  kind: "error" | "notice";
  message: string;
  retry?: () => void;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function useRouteEditorReports(t: Translate): {
  reports: Partial<Record<RouteEditorSection, RouteEditorReport>>;
  report: (section: RouteEditorSection, entry: RouteEditorReport) => void;
  clear: (section: RouteEditorSection) => void;
  /**
   * A failure, said in its section: never the server's English prose (a code
   * maps to DE/EN copy, anything else to the section's own sentence), and a
   * retry where pressing again can help.
   */
  fail: (
    section: RouteEditorSection,
    err: unknown,
    fallbackKey: string,
    retry?: () => void,
    codeKeys?: Readonly<Record<string, string>>
  ) => void;
} {
  const [reports, setReports] = useState<Partial<Record<RouteEditorSection, RouteEditorReport>>>(
    {}
  );
  const report = useCallback(
    (section: RouteEditorSection, entry: RouteEditorReport): void =>
      setReports((prev) => ({ ...prev, [section]: entry })),
    []
  );
  const clear = useCallback(
    (section: RouteEditorSection): void =>
      setReports((prev) => {
        if (!(section in prev)) return prev;
        const { [section]: _gone, ...rest } = prev;
        return rest;
      }),
    []
  );
  const fail = useCallback(
    (
      section: RouteEditorSection,
      err: unknown,
      fallbackKey: string,
      retry?: () => void,
      codeKeys: Readonly<Record<string, string>> = {}
    ): void => {
      const key = saveErrorKey(err, fallbackKey, codeKeys);
      report(section, {
        kind: "error",
        message: t(key),
        retry: retry && isTransientSaveError(key) ? retry : undefined,
      });
    },
    [report, t]
  );
  return { reports, report, clear, fail };
}

/** One section's report: an error banner, or a notice that stays. */
export function RouteEditorReportLine({
  entry,
}: {
  entry: RouteEditorReport | undefined;
}): JSX.Element | null {
  if (!entry) return null;
  if (entry.kind === "error") {
    return <FormErrorBanner message={entry.message} onRetry={entry.retry} />;
  }
  return (
    <p
      role="status"
      className="mt-3 rounded-md border px-3 py-2 text-sm"
      style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
    >
      {entry.message}
    </p>
  );
}
