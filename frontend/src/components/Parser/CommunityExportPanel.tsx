import { useState } from "react";
import type { JSX } from "react";
import { parserTemplatesApi, type CommunityExportFile } from "../../lib/api";
import { apiErrorMachineCode } from "../../lib/apiError";
import { downloadBlob } from "../../lib/export";
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

/**
 * "Für die Community exportieren" for one of the user's templates
 * (forgejo#309). The server builds the repository file with the user's own
 * data taken out; this downloads it and offers GitHub's new-file page in the
 * domain's folder, where the user pastes or uploads it. Nothing is posted
 * from TravStats — the repository owner reviews every contribution.
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
  const kindLabel = (kind: string): string =>
    t(
      GENERIC_KINDS.has(kind)
        ? `parser:communityExport.kind.${kind}`
        : `parser:labels.${domain}.${kind}`
    );

  const run = async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    setFound([]);
    setFile(null);
    try {
      const exported = await parserTemplatesApi.communityExport(templateId);
      downloadBlob(
        new Blob([`${JSON.stringify(exported.template, null, 2)}\n`], {
          type: "application/json",
        }),
        exported.filename
      );
      setFile(exported);
    } catch (error) {
      logger.error({ error }, "CommunityExportPanel: export failed");
      setRefusal(refusalKey(error));
      setFound(foundKinds(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 text-sm" data-testid={`community-export-${templateId}`}>
      <p className="t-caption">{t("parser:communityExport.explain")}</p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        {t(busy ? "parser:communityExport.working" : "parser:communityExport.download")}
      </button>
      {refusal && (
        <p role="alert" style={{ color: "var(--danger)" }}>
          {t(refusal)}
          {found.length > 0 &&
            ` ${t("parser:communityExport.found", { what: found.map(kindLabel).join(", ") })}`}
        </p>
      )}
      {file && (
        <div role="status" className="space-y-2">
          <p>{t("parser:communityExport.downloaded", { filename: file.filename })}</p>
          {file.removed.length > 0 && (
            <p className="t-caption">
              {t("parser:communityExport.removed", { count: file.removed.length })}
            </p>
          )}
          <p className="t-caption">{t("parser:communityExport.testCases")}</p>
          <a
            href={file.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-block text-xs px-3 py-1.5"
          >
            {t("parser:communityExport.openGithub")}
          </a>
        </div>
      )}
    </div>
  );
}
