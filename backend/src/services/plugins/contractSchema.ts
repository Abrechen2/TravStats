/**
 * The plugin contract as a JSON Schema document, built from the OpenAPI
 * components the server itself registers (spec 2026-11-23-plugins-and-
 * calendar.md, P5). The template's `contract/v1.schema.json` is this document
 * written to disk (`scripts/export-plugin-contract.ts`); a test holds the file
 * to it, so the guide and the server cannot drift.
 */
import "../openapi/paths";
import { buildOpenApiDocument } from "../openapi/registry";

export const CONTRACT_COMPONENTS = [
  "SuggestionPluginRequestV1",
  "SuggestionPluginStopV1",
  "SuggestionPluginResponseV1",
  "SuggestionPluginSuggestionV1",
  "SuggestionPluginHelloV1",
] as const;

const rewriteRefs = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([k, v]) => [
      k,
      k === "$ref" && typeof v === "string"
        ? v.replace("#/components/schemas/", "#/$defs/")
        : rewriteRefs(v),
    ])
  );
};

export function pluginContractSchema(): Record<string, unknown> {
  const schemas = (buildOpenApiDocument().components?.schemas ?? {}) as Record<string, unknown>;
  const defs: Record<string, unknown> = {};
  for (const name of CONTRACT_COMPONENTS) {
    if (!schemas[name]) throw new Error(`OpenAPI component ${name} is missing`);
    defs[name] = rewriteRefs(schemas[name]);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://travstats.de/schemas/suggestion-plugin/v1.schema.json",
    title: "TravStats suggestion plugin contract, version 1",
    description:
      "Exported from the TravStats server's OpenAPI document (scripts/export-plugin-contract.ts). " +
      "Do not edit by hand. Request: what TravStats POSTs; response: what the plugin answers; " +
      "hello: the optional signed GET.",
    $defs: defs,
    properties: {
      request: { $ref: "#/$defs/SuggestionPluginRequestV1" },
      response: { $ref: "#/$defs/SuggestionPluginResponseV1" },
      hello: { $ref: "#/$defs/SuggestionPluginHelloV1" },
    },
  };
}

export const serialiseContract = (schema: Record<string, unknown>): string =>
  `${JSON.stringify(schema, null, 2)}\n`;
