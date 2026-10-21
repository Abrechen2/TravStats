import { api } from "./client";

/**
 * `/admin/template-repo` (forgejo#309): where the parser templates are synced
 * from — the admin's instance setting, which wins over the server's
 * `TEMPLATE_REPO_BASE_URL`. Bare family, like every admin route.
 */
export interface TemplateRepoState {
  /** What the admin stored; null = not set (the env var or the default applies). */
  url: string | null;
  /** What the next sync reads. */
  effectiveUrl: string;
  origin: "admin" | "env" | "default";
  defaultUrl: string;
}

export interface TemplateRepoSaved extends TemplateRepoState {
  /** The re-sync the save ran: `unavailable` = the new index was not read; the last good set serves. */
  sync: { index: "unknown" | "available" | "unavailable"; ranAt: string | null; active: number };
}

export type TemplateRepoTestResult =
  | "ok"
  | "invalidUrl"
  | "httpsRequired"
  | "credentialsInUrl"
  | "unreachable"
  | "tooLarge"
  | "notAnIndex";

export const templateRepoApi = {
  async get(): Promise<TemplateRepoState> {
    return (await api.get<TemplateRepoState>("/admin/template-repo")).data;
  },
  /** Store (null clears) and re-sync at once — may take a while on a large repository. */
  async save(url: string | null): Promise<TemplateRepoSaved> {
    return (await api.put<TemplateRepoSaved>("/admin/template-repo", { url }, { timeout: 180000 }))
      .data;
  },
  async test(
    url: string | null
  ): Promise<{ result: TemplateRepoTestResult; templates: number | null }> {
    return (
      await api.post<{ result: TemplateRepoTestResult; templates: number | null }>(
        "/admin/template-repo/test",
        { url },
        { timeout: 30000 }
      )
    ).data;
  },
};
