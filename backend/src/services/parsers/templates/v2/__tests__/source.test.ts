import { describe, it, expect } from "@jest/globals";
import {
  checkTemplateRepoUrl,
  DEFAULT_TEMPLATE_REPO_BASE_URL,
  effectiveTemplateRepo,
  resolveTemplateRepoBaseUrl,
} from "../source";

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

describe("the admin's template repository URL (forgejo#309)", () => {
  it("takes https anywhere and plain http to a local/LAN host only", () => {
    expect(checkTemplateRepoUrl("https://git.example.org/raw/main/")).toEqual({
      ok: true,
      url: "https://git.example.org/raw/main",
    });
    expect(checkTemplateRepoUrl("http://192.168.178.20:3000/raw/main")).toEqual({
      ok: true,
      url: "http://192.168.178.20:3000/raw/main",
    });
    expect(checkTemplateRepoUrl("http://forgejo.lan/raw")).toMatchObject({ ok: true });
    expect(checkTemplateRepoUrl("http://templates.example.org/raw")).toEqual({
      ok: false,
      problem: "https_required",
    });
  });

  it("refuses credentials in the URL and anything that is not http(s)", () => {
    expect(checkTemplateRepoUrl("https://user:secret@git.example.org/raw")).toEqual({
      ok: false,
      problem: "credentials_in_url",
    });
    expect(checkTemplateRepoUrl("ftp://git.example.org/raw")).toMatchObject({ ok: false });
    expect(checkTemplateRepoUrl("not a url")).toEqual({ ok: false, problem: "invalid_url" });
  });

  it("lets the admin setting win over the env var, and the env var over the default", () => {
    expect(
      effectiveTemplateRepo("https://mirror.example.org/t", "https://env.example.org/t")
    ).toEqual({ url: "https://mirror.example.org/t", origin: "admin" });
    expect(effectiveTemplateRepo(null, "https://env.example.org/t")).toEqual({
      url: "https://env.example.org/t",
      origin: "env",
    });
    expect(effectiveTemplateRepo(null, undefined)).toEqual({
      url: DEFAULT_TEMPLATE_REPO_BASE_URL,
      origin: "default",
    });
  });

  it("ignores a stored value that no longer passes the check instead of fetching it", () => {
    expect(effectiveTemplateRepo("http://public.example.org/t", undefined)).toEqual({
      url: DEFAULT_TEMPLATE_REPO_BASE_URL,
      origin: "default",
    });
  });
});
