import { afterEach, describe, expect, it } from "vitest";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";

import { api } from "../client";
import { canFileBy, clearFilingDocument, setFilingDocument } from "../filingDocument";

/**
 * "Neu anlegen aus Dokument" files by the document's exact id, in the request that creates the
 * entry — never by guessing which entry was "the one created since". Two creates of the same
 * domain in flight together must give the id to exactly one request.
 */
function capture(status = 201): { sent: Array<{ url: string; body: unknown }> } {
  const sent: Array<{ url: string; body: unknown }> = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    sent.push({
      url: String(config.url),
      body: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
    });
    const response = { data: {}, status, statusText: "", headers: {}, config };
    if (status >= 400) throw Object.assign(new Error("fail"), { config, response });
    return response;
  };
  api.defaults.adapter = adapter;
  return { sent };
}

describe("filing a handed-over document by id", () => {
  afterEach(() => {
    clearFilingDocument();
  });

  it("gives the id to exactly one of two concurrent creates of the same domain", async () => {
    const { sent } = capture();
    setFilingDocument("doc-1", "flight");
    await Promise.all([api.post("/flights", { n: 1 }), api.post("/flights", { n: 2 })]);
    const carrying = sent.filter((r) => (r.body as { documentIds?: string[] }).documentIds);
    expect(carrying).toHaveLength(1);
    expect(carrying[0].body).toMatchObject({ documentIds: ["doc-1"] });
    expect(clearFilingDocument()).toBe(true);
  });

  it("leaves other routes and other methods alone", async () => {
    const { sent } = capture();
    setFilingDocument("doc-1", "flight");
    await api.post("/cruises", { n: 1 });
    await api.put("/flights", { n: 2 });
    expect(sent.some((r) => (r.body as { documentIds?: unknown }).documentIds)).toBe(false);
    expect(clearFilingDocument()).toBe(false);
  });

  it("keeps offering the id after a failed create, and stops after a successful one", async () => {
    capture(500);
    setFilingDocument("doc-1", "rail");
    await api.post("/rail", {}).catch(() => undefined);
    const retry = capture();
    await api.post("/rail", {});
    await api.post("/rail", {});
    expect(
      retry.sent.filter((r) => (r.body as { documentIds?: unknown }).documentIds)
    ).toHaveLength(1);
  });

  it("carries the id on the lodging import commit, and reports a document the server left unfiled", async () => {
    expect(canFileBy("lodging")).toBe(true);
    const sent: unknown[] = [];
    api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      sent.push(JSON.parse(String(config.data)));
      return {
        data: {
          success: true,
          data: { documentFiled: false, documentNotFiledReason: "link_failed" },
        },
        status: 201,
        statusText: "",
        headers: {},
        config,
      };
    }) as AxiosAdapter;
    setFilingDocument("doc-9", "lodging");
    await api.post("/lodging-import/commit", { rows: [] });
    expect(sent[0]).toMatchObject({ documentIds: ["doc-9"] });
    expect(clearFilingDocument()).toBe(false);
  });

  it("counts a lodging commit that filed the document as filed", async () => {
    api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => ({
      data: { success: true, data: { documentFiled: true } },
      status: 201,
      statusText: "",
      headers: {},
      config,
    })) as AxiosAdapter;
    setFilingDocument("doc-9", "lodging");
    await api.post("/lodging-import/commit", { rows: [] });
    expect(clearFilingDocument()).toBe(true);
  });
});
