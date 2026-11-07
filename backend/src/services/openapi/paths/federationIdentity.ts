/** The public federation identity (spec 2026-11-07 §6.2). Unauthenticated, bare family. */
import { federationIdentityResponseSchema } from "../../../schemas/federationAdmission";
import { registry } from "../registry";
import { errorContent } from "./shared";

registry.registerPath({
  method: "get",
  path: "/federation/identity",
  summary: "This server's public federation identity",
  description:
    "Origin, Ed25519 public key (32 raw bytes, base64url), fingerprint and the leaderboard protocol versions this server speaks. " +
    "A public key is public: another server reads this to check that an origin and a key belong together before its admin pins it. " +
    "Unauthenticated, 60 requests a minute per address.",
  tags: ["Federation"],
  security: [],
  responses: {
    200: {
      description: "The identity",
      content: { "application/json": { schema: federationIdentityResponseSchema } },
    },
    404: {
      description: "`FEDERATION_OFF`: federation is switched off here",
      content: errorContent,
    },
    429: { description: "Too many requests", content: errorContent },
  },
});
