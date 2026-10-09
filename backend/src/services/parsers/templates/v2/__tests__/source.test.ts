import { describe, it, expect } from "@jest/globals";
import { DEFAULT_TEMPLATE_REPO_BASE_URL, resolveTemplateRepoBaseUrl } from "../source";

describe("TEMPLATE_REPO_BASE_URL", () => {
  it("defaults to the official repository root", () => {
    expect(resolveTemplateRepoBaseUrl(undefined)).toBe(
      "https://raw.githubusercontent.com/Abrechen2/travstats-templates/main"
    );
    expect(resolveTemplateRepoBaseUrl("  ")).toBe(DEFAULT_TEMPLATE_REPO_BASE_URL);
  });

  it("takes an https base and drops a trailing slash", () => {
    expect(resolveTemplateRepoBaseUrl("https://git.lan/raw/main/")).toBe(
      "https://git.lan/raw/main"
    );
  });

  it("falls back to the default for anything that is not https", () => {
    expect(resolveTemplateRepoBaseUrl("http://git.lan/raw")).toBe(DEFAULT_TEMPLATE_REPO_BASE_URL);
    expect(resolveTemplateRepoBaseUrl("not a url")).toBe(DEFAULT_TEMPLATE_REPO_BASE_URL);
  });
});
