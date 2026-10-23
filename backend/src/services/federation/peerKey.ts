/**
 * Reading another server's public key, as an admin pastes it or a connection file carries
 * it. One home for the checks, so the pin route and the file import cannot disagree about
 * what counts as a key.
 */
import { createPublicKey } from "crypto";

const PEM_BLOCK = /^\s*-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----\s*$/;
const PUBLIC_KEY_LABEL = "PUBLIC KEY";

/** The label of a single PEM block ("PUBLIC KEY", "PRIVATE KEY", …), or null for anything else. */
const pemLabel = (pem: string): string | null => PEM_BLOCK.exec(pem)?.[1] ?? null;

/**
 * A pasted PEM often arrives with its newlines flattened to spaces or dropped (single-line
 * inputs, chat clients, e-mail). Re-wrap header, 64-column body and footer so
 * createPublicKey sees what it requires; anything that is not a PEM block passes unchanged
 * and is refused by the key parse as before.
 */
export function normalisePastedPem(input: string): string {
  const match = PEM_BLOCK.exec(input);
  if (!match) return input;
  const body = match[2].replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${match[1]}-----\n${lines.join("\n")}\n-----END ${match[1]}-----\n`;
}

/**
 * The Ed25519 public key in `input` as SPKI PEM — exactly the text `hash()` fingerprints and
 * the peer table stores — or null when it is not one.
 */
export function parsePeerPublicKey(input: string): string | null {
  const pasted = normalisePastedPem(input);
  // createPublicKey also derives a public key from a PRIVATE key PEM, so a pasted private
  // key would pin and look fine. A private key in this field is a leaked key — refuse it.
  if (pemLabel(pasted) !== PUBLIC_KEY_LABEL) return null;
  try {
    const key = createPublicKey(pasted);
    if (key.asymmetricKeyType !== "ed25519") return null;
    return key.export({ type: "spki", format: "pem" }).toString();
  } catch {
    return null;
  }
}
