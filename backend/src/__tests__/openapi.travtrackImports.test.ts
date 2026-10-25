import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

/**
 * The GPX import's documented contract (TravTrack plan E8, Codex review P3):
 * the upload is a file — binary, not a string field — and a client learns
 * that the account's bucket can answer 429.
 */

type Op = {
  requestBody?: {
    content: Record<string, { schema: { properties?: Record<string, { format?: string }> } }>;
  };
  responses: Record<string, unknown>;
};

const doc = buildOpenApiDocument() as unknown as { paths: Record<string, Record<string, Op>> };

describe("OpenAPI — POST /travtrack/imports", () => {
  const post = doc.paths["/travtrack/imports"].post;

  it("documents the file as binary multipart content", () => {
    const file = post.requestBody?.content["multipart/form-data"].schema.properties?.file;
    expect(file?.format).toBe("binary");
  });

  it("documents the rate limit", () => {
    expect(Object.keys(post.responses)).toContain("429");
  });
});
