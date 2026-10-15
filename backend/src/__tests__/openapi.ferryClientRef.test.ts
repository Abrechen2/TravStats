import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

it("documents ferry idempotency on the create request and its replay/conflict responses", () => {
  const document = buildOpenApiDocument();
  const post = document.paths["/ferry"]?.post;
  expect(post).toBeDefined();
  expect(JSON.stringify(post?.requestBody)).toContain('"clientRef"');
  expect(post?.responses).toHaveProperty("200");
  expect(post?.responses).toHaveProperty("201");
  expect(post?.responses).toHaveProperty("409");
  expect(post?.responses).toHaveProperty("410");
});

it("advertises version preconditions for ferry edits and deletes", () => {
  const document = buildOpenApiDocument();
  const path = document.paths["/ferry/{id}"];
  expect(JSON.stringify(path?.patch?.requestBody)).toContain('"baseVersion"');
  expect(path?.delete?.parameters).toEqual(
    expect.arrayContaining([expect.objectContaining({ in: "header", name: "If-Match" })])
  );
  expect(path?.patch?.responses).toHaveProperty("409");
  expect(path?.delete?.responses).toHaveProperty("409");
});
