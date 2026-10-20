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
