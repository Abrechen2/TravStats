import logger from "../../../../utils/logger";
import { checkLlmBaseUrl } from "../../../llm/llmEndpoint";

/**
 * Where templates come from: the raw-file root of a template repository.
 *
 * The v2 index lives at `<base>/index.json`, the legacy v1 airline index at
 * `<base>/templates/index.json`. Three sources, first one set wins
 * (`effectiveTemplateRepo`): the admin's instance setting
 * (`admin_settings.template_repo_base_url`, forgejo#309), the
 * `TEMPLATE_REPO_BASE_URL` env var, the official repository.
 *
 * Like the Immich URL there is no egress allowlist — an admin may point at a
 * private Git host on the LAN. The admin setting follows the one endpoint
 * rule the model URLs follow (`llm/llmEndpoint.ts`): https, or plain http to a
 * local/LAN host only (loopback, RFC 1918, ULA, `.lan`/`.local`/…, or a
 * single-label name), and never credentials in the URL — it is stored in
 * plain text and shown back. The env var stays https-only, as it always was.
 */
export const DEFAULT_TEMPLATE_REPO_BASE_URL =
  "https://raw.githubusercontent.com/Abrechen2/travstats-templates/main";

export function resolveTemplateRepoBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_TEMPLATE_REPO_BASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("not https");
    return value.replace(/\/+$/, "");
  } catch {
    logger.warn(
      { value },
      "TEMPLATE_REPO_BASE_URL is not an https URL — using the official template repository"
    );
    return DEFAULT_TEMPLATE_REPO_BASE_URL;
  }
}

/** Why an admin's template repository URL was refused — the codes the UI words. */
export type TemplateRepoUrlProblem =
  "invalid_url" | "unsupported_protocol" | "credentials_in_url" | "https_required";

export type TemplateRepoUrlCheck =
  { ok: true; url: string } | { ok: false; problem: TemplateRepoUrlProblem };

/** Validate and normalise (no trailing slash, no query) a URL the admin typed. */
export function checkTemplateRepoUrl(raw: string): TemplateRepoUrlCheck {
  const check = checkLlmBaseUrl(raw);
  return check.ok ? { ok: true, url: check.url } : { ok: false, problem: check.problem };
}

export type TemplateRepoOrigin = "admin" | "env" | "default";

/**
 * The repository the sync reads, and which source named it. A stored admin
 * value that no longer passes the check (hand-edited, an older rule) is
 * ignored with a warning rather than fetched.
 */
export function effectiveTemplateRepo(
  adminUrl: string | null | undefined,
  envUrl: string | undefined
): { url: string; origin: TemplateRepoOrigin } {
  if (adminUrl) {
    const check = checkTemplateRepoUrl(adminUrl);
    if (check.ok) return { url: check.url, origin: "admin" };
    logger.warn(
      { problem: check.problem },
      "The stored template repository URL is not valid — ignoring it"
    );
  }
  const fromEnv = resolveTemplateRepoBaseUrl(envUrl);
  return {
    url: fromEnv,
    origin: envUrl?.trim() && fromEnv !== DEFAULT_TEMPLATE_REPO_BASE_URL ? "env" : "default",
  };
}
