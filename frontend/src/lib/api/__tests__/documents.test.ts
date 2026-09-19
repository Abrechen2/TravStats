import { describe, it, expect, vi, beforeEach } from "vitest";

import { api } from "../client";
import {
  documentFileUrl,
  documentListPath,
  documentsApi,
  isDemoForbidden,
  type TravelDocument,
} from "../documents";

vi.mock("../client", () => ({
  API_URL: "",
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const boardingPass: TravelDocument = {
  id: "d1",
  format: "pdf",
  kind: "boardingPass",
  mimetype: "application/pdf",
  sizeBytes: 2048,
  sha256: "abc",
  originalName: "LH2462.pdf",
  displayName: "LH2462.pdf",
  issuedOn: "2026-09-18",
  source: "upload",
  parsedDomain: null,
  entry: { type: "flight", id: "f1" },
  createdAt: "2026-09-18T10:00:00.000Z",
  linkedAt: "2026-09-18T10:00:00.000Z",
  url: "/api/v1/documents/d1/file",
};

describe("documentListPath", () => {
  // The five prefixes of `routes/documents.ts`'s ENTRY_LIST_PATHS. Spelled out
  // in the test as well as in the module, because a derivation that agrees
  // with itself proves nothing.
  it("names the path the server serves, for each of the five entry types", () => {
    expect(documentListPath({ type: "flight", id: "f1" })).toBe("/flights/f1/documents");
    expect(documentListPath({ type: "cruise", id: "c1" })).toBe("/cruises/c1/documents");
    expect(documentListPath({ type: "lodgingStay", id: "s1" })).toBe("/lodging/stays/s1/documents");
    expect(documentListPath({ type: "placeVisit", id: "v1" })).toBe("/places/visits/v1/documents");
    expect(documentListPath({ type: "trip", id: "t1" })).toBe("/trips/t1/documents");
  });
});

describe("documentsApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unwraps the {success, data} envelope the router answers with", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [boardingPass] } });
    await expect(documentsApi.listForEntry({ type: "flight", id: "f1" })).resolves.toEqual([
      boardingPass,
    ]);
    expect(api.get).toHaveBeenCalledWith("/flights/f1/documents");
  });

  it("uploads multipart to /documents, naming the entry in the form", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: boardingPass } });
    const file = new File(["x"], "LH2462.pdf", { type: "application/pdf" });
    await documentsApi.upload({ entry: { type: "lodgingStay", id: "s1" }, file });

    const [path, form, config] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe("/documents");
    expect(form).toBeInstanceOf(FormData);
    const sent = form as FormData;
    expect(sent.get("entryType")).toBe("lodgingStay");
    expect(sent.get("entryId")).toBe("s1");
    expect(sent.get("file")).toBe(file);
    // The format is deliberately NOT sent: the server decides from the bytes.
    expect(sent.get("format")).toBeNull();
    // And no Content-Type of our own. A multipart type without a boundary is
    // an unparsable request; axios scrubs ours in a browser and hands the job
    // to the platform (helpers/resolveConfig.js), so writing one here asserts
    // a header that never reaches the wire — and breaks the upload anywhere
    // that scrubbing does not happen.
    expect(config?.headers).toBeUndefined();
  });

  it("gives a 10 MB document longer than the shared 10-second timeout", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: boardingPass } });
    const file = new File(["x"], "bill.pdf", { type: "application/pdf" });
    await documentsApi.upload({ entry: { type: "flight", id: "f1" }, file });

    // The shared instance is set up for reads. A 10 MB scan on a domestic
    // uplink outruns that, and the request the browser abandons is one the
    // server has already stored — so the user sees a failure and a duplicate
    // on the next try.
    expect(vi.mocked(api.post).mock.calls[0][2]?.timeout).toBe(120_000);
  });

  it("asks for the limits once and serves every later caller from that answer", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { image: 1, pdf: 2, eml: 3, emailText: 4, pkpass: 5 } },
    });
    const first = await documentsApi.limits();
    const second = await documentsApi.limits();
    expect(second).toBe(first);
    // A place with six visits asked six times for the same five numbers before.
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe("documentFileUrl", () => {
  it("uses the path the server built, rather than rebuilding it", () => {
    expect(documentFileUrl(boardingPass)).toBe("/api/v1/documents/d1/file");
  });
});

describe("isDemoForbidden", () => {
  it("recognises the demo guard's 403, and nothing else", () => {
    expect(
      isDemoForbidden({ response: { status: 403, data: { error: "DEMO_ACCOUNT_FORBIDDEN" } } })
    ).toBe(true);
    // A write-scope refusal is also a 403 and is NOT the demo sentence.
    expect(isDemoForbidden({ response: { status: 403, data: { error: "READ_ONLY_TOKEN" } } })).toBe(
      false
    );
    expect(isDemoForbidden({ response: { status: 413, data: {} } })).toBe(false);
    expect(isDemoForbidden(new Error("network"))).toBe(false);
  });
});
