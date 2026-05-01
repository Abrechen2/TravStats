/**
 * Mounts the OpenAPI spec + Swagger UI under /api/v1.
 *
 *   GET  /api/v1/openapi.json   — machine-readable spec (no auth)
 *   GET  /api/v1/docs           — Swagger UI (no auth)
 *
 * Both are deliberately public: the spec describes the API contract,
 * which is also visible in the open-source frontend code, and Swagger
 * UI is only useful when paired with a real PAT. Hiding the docs
 * behind auth would just lock out the very integration scenario this
 * feature exists to support.
 *
 * Importing `paths` runs all the registry registrations at module-load
 * time (side-effect-only). This is intentional: the spec is built
 * eagerly on boot and served from memory.
 */

import { Router } from "express";
import swaggerUi from "swagger-ui-express";

import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

const router = Router();

const document = buildOpenApiDocument();

router.get("/openapi.json", (_req, res) => {
  res.json(document);
});

router.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: "list",
    },
    customSiteTitle: "TravStats API",
  })
);

export default router;
