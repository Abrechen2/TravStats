import { useState } from "react";
import type { JSX } from "react";
import { parserTemplatesApi, type CommunityExportFile } from "../../lib/api";
import { apiErrorMachineCode } from "../../lib/apiError";
import { downloadBlob } from "../../lib/export";
import {
  buildTemplateIssue,
  findPersonalText,
  type PersonalTextKind,
} from "../../lib/communityIssue";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

/** The workshop domains whose templates the repository takes (v2 envelopes). */
export const SHAREABLE_DOMAINS: ReadonlySet<string> = new Set([
  "cruise",
  "place",
  "package",
  "rail",
  "rental",
  "bus",
  "ferry",
]);

const KNOWN_REFUSALS = new Set([
  "TEMPLATE_EXPORT_PERSONAL_DATA",
  "TEMPLATE_EXPORT_NOT_ACTIVE",
  "TEMPLATE_EXPORT_UNSUPPORTED",
  "TEMPLATE_EXPORT_SOURCE_MISSING",
]);

/** The refusal's copy key: the server's code, or the generic failure. */
function refusalKey(error: unknown): string {
  const code = apiErrorMachineCode(error);
  return code && KNOWN_REFUSALS.has(code)
    ? `parser:communityExport.refused.${code}`
    : "parser:communityExport.failed";
}

/** What the server found (`kinds`: annotation labels, or identity / email / number). */
function foundKinds(error: unknown): string[] {
  const kinds = (error as { response?: { data?: { kinds?: unknown } } } | undefined)?.response?.data
    ?.kinds;
  return typeof kinds === "string" && kinds.length > 0 ? kinds.split(",") : [];
}

const GENERIC_KINDS = new Set(["identity", "email", "number"]);

/** How the "copy the JSON by hand" fallback ended. */
type CopyState = "idle" | "copied" | "manual";

/**
 * "Mit der Community teilen" for one of the user's templates (forgejo#309,
 * forgejo#330). The server builds the repository file with the user's own
 * data taken out; this shows exactly that file, and only then opens a
 * prefilled "template request" in the public template repository under the
 * user's own GitHub account. Nothing is posted from TravStats; the sample
 * document never leaves, and the repository owner reviews every request.
 */
export default function CommunityExportPanel({
  templateId,
  domain,
}: {
  templateId: string;
  domain: string;
}): JSX.Element {
  const { t } = useTranslation(["parser"]);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<CommunityExportFile | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [found, setFound] = useState<string[]>([]);
  const [copy, setCopy] = useState<CopyState>("idle");
  const kindLabel = (kind: string): string =>
    t(
      GENERIC_KINDS.has(kind)
        ? `parser:communityExport.kind.${kind}`
        : `parser:labels.${domain}.${kind}`
    );

  const review = async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    setFound([]);
    setFile(null);
    setCopy("idle");
    try {
      setFile(await parserTemplatesApi.communityExport(templateId));
    } catch (error) {
      logger.error({ error }, "CommunityExportPanel: export failed");
      setRefusal(refusalKey(error));
      setFound(foundKinds(error));
    } finally {
      setBusy(false);
    }
  };

  const issue = file ? buildTemplateIssue(file.template) : null;
  // A second look at the very text that is about to leave: the server already
  // took the account's own values out, this catches a shape that looks personal.
  const suspicious: PersonalTextKind[] = file ? findPersonalText(file.template) : [];

  const openIssue = async (): Promise<void> => {
    if (!issue || suspicious.length > 0) return;
    if (!issue.tooLong) {
      window.open(issue.url, "_blank", "noopener,noreferrer");
      return;
    }
    // Too long for a link: the JSON goes to the clipboard, the form opens empty.
    let copied = false;
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(issue.fields.template_json);
        copied = true;
      }
    } catch (error) {
      logger.error({ error }, "CommunityExportPanel: clipboard unavailable");
    }
    setCopy(copied ? "copied" : "manual");
    window.open(issue.urlWithoutJson, "_blank", "noopener,noreferrer");
  };

  const saveFile = (): void => {
    if (!file) return;
    downloadBlob(
      new Blob([`${JSON.stringify(file.template, null, 2)}\n`], { type: "application/json" }),
      file.filename
    );
  };

  return (
    <div className="mt-3 space-y-2 text-sm" data-testid={`community-export-${templateId}`}>
      <p className="t-caption">{t("parser:communityExport.explain")}</p>
      {!file && (
        <button
          type="button"
          onClick={() => void review()}
          disabled={busy}
          className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {t(busy ? "parser:communityExport.working" : "parser:communityExport.review")}
        </button>
      )}
      {refusal && (
        <p role="alert" style={{ color: "var(--danger)" }}>
          {t(refusal)}
          {found.length > 0 &&
            ` ${t("parser:communityExport.found", { what: found.map(kindLabel).join(", ") })}`}
        </p>
      )}
      {file && issue && (
        <div className="space-y-2" data-testid="community-export-review">
          <h3 className="font-semibold" style={{ color: "var(--ts-text-bright)" }}>
            {t("parser:communityExport.reviewTitle")}
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="t-caption">{t("parser:communityExport.provider")}</dt>
            <dd>{issue.fields.provider || t("parser:communityExport.none")}</dd>
            <dt className="t-caption">{t("parser:communityExport.markets")}</dt>
            <dd>{issue.fields.markets || t("parser:communityExport.none")}</dd>
          </dl>
          <pre
            className="max-h-64 overflow-auto rounded-lg p-3 text-xs"
            style={{ background: "var(--bg-base)", border: "1px solid var(--ts-border)" }}
            tabIndex={0}
            aria-label={t("parser:communityExport.jsonLabel")}
          >
            {issue.fields.template_json}
          </pre>
          {file.removed.length > 0 && (
            <p className="t-caption">
              {t("parser:communityExport.removed", { count: file.removed.length })}
            </p>
          )}
          <p className="t-caption">{t("parser:communityExport.testCases")}</p>
          {suspicious.length > 0 && (
            <p role="alert" style={{ color: "var(--danger)" }}>
              {t("parser:communityExport.looksPersonal", {
                what: suspicious.map((k) => t(`parser:communityExport.suspect.${k}`)).join(", "),
              })}
            </p>
          )}
          {issue.tooLong && <p className="t-caption">{t("parser:communityExport.tooLong")}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void openIssue()}
              disabled={suspicious.length > 0}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {t(
                issue.tooLong
                  ? "parser:communityExport.copyAndOpen"
                  : "parser:communityExport.openIssue"
              )}
            </button>
            <button type="button" onClick={saveFile} className="btn-secondary text-xs px-3 py-1.5">
              {t("parser:communityExport.download")}
            </button>
          </div>
          {copy === "copied" && <p role="status">{t("parser:communityExport.copied")}</p>}
          {copy === "manual" && (
            <p role="alert" style={{ color: "var(--warning)" }}>
              {t("parser:communityExport.copyFailed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
