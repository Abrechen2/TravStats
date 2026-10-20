import { describe, it, expect } from "@jest/globals";
import { fetchJson } from "../fetchJson";

/**
 * forgejo#309: the fetcher speaks plain http to a local/LAN host (an admin's
 * self-hosted mirror) and to nothing else — refused before any request.
 */
describe("fetchJson", () => {
  it("refuses plain http to a public host without sending a request", async () => {
    await expect(fetchJson("http://templates.example.org/index.json")).rejects.toThrow(
      /local host only/
    );
  });

  it("refuses a protocol that is neither http nor https", async () => {
    await expect(fetchJson("ftp://templates.example.org/index.json")).rejects.toThrow(
      /Unsupported protocol/
    );
  });
});
