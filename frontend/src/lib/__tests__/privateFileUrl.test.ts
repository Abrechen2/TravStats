import { describe, expect, it } from "vitest";

import { canonicalPrivateFileUrl } from "../privateFileUrl";

describe("canonicalPrivateFileUrl (forgejo#284)", () => {
  it.each([
    ["/api/v1/uploads/receipts/1-ab-bill.pdf", "/api/v1/uploads/receipts/1-ab-bill.pdf/content"],
    [
      "/api/v1/settings/profile-picture/u_1-ff.jpg",
      "/api/v1/settings/profile-picture/u_1-ff.jpg/content",
    ],
  ])("moves %s off its file extension", (legacy, canonical) => {
    expect(canonicalPrivateFileUrl(legacy)).toBe(canonical);
  });

  it.each([
    "/api/v1/uploads/receipts/1-ab-bill.pdf/content",
    "/api/v1/documents/7f0c1a52-0000-4000-8000-000000000000/file",
    "https://example.com/avatar.png",
  ])("leaves %s alone", (url) => {
    expect(canonicalPrivateFileUrl(url)).toBe(url);
  });
});
