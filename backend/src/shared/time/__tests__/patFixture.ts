import { prisma } from "../../../db";
import { generateApiToken } from "../../../utils/apiTokens";

/**
 * A personal access token for a time-model route test: with `deviceId` it is
 * the Companion (paired device), without one a script. Returns the header.
 */
export async function mintWriteToken(
  userId: string,
  options: { deviceId?: string; label?: string } = {}
): Promise<string> {
  const tok = await generateApiToken();
  await prisma.apiToken.create({
    data: {
      userId,
      label: options.label ?? "time-model-test",
      lookupHash: tok.lookupHash,
      hash: tok.hash,
      scope: "write",
      deviceId: options.deviceId ?? null,
    },
  });
  return `Bearer ${tok.plaintext}`;
}
