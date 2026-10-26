import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

// The Companion's outbox creates (forgejo#283): each documents the key and its answers.
it.each([
  "/cruises",
  "/places",
  "/places/{id}/visits",
  "/lodging",
  "/lodging/{id}/stays",
  "/flights",
])("documents clientRef on POST %s with its replay and conflict responses", (path) => {
  const post = buildOpenApiDocument().paths[path]?.post;
  expect(post).toBeDefined();
  expect(JSON.stringify(post?.requestBody)).toContain('"clientRef"');
  for (const status of ["200", "201", "409", "410"]) {
    expect(post?.responses).toHaveProperty(status);
  }
  expect(JSON.stringify(post?.responses?.["409"])).toContain("CLIENT_REF_REUSED");
  expect(JSON.stringify(post?.responses?.["410"])).toContain("CLIENT_REF_TARGET_GONE");
});
