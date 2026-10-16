import { generateKeyPairSync, sign } from "crypto";
import { publicAddress, verifyEnvelope } from "../security";
import { scopeSchema, packetBody } from "../contract";
const keys = generateKeyPairSync("ed25519");
const pub = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
function message() {
  const m = {
    origin: "https://a.example",
    destination: "https://b.example",
    nonce: "a".repeat(64),
    time: 1000000,
    body: '{"action":"ping"}',
  };
  return {
    ...m,
    signature: sign(null, Buffer.from(JSON.stringify(m)), keys.privateKey).toString("base64"),
  };
}
it.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "192.168.1.1",
  "100.64.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "fe80::1",
  "fc00::1",
  "2001:db8::1",
  "2002:0808:0808::1",
  "224.0.0.1",
  "0.0.0.0",
])("rejects non-public destination %s", (ip) => expect(publicAddress(ip)).toBe(false));
it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("recognises public destination %s", (ip) =>
  expect(publicAddress(ip)).toBe(true)
);
it("binds the signature to body, sender, destination and time", () => {
  const m = message();
  expect(verifyEnvelope(m, pub, m.destination, m.time)).toEqual(m);
  expect(() =>
    verifyEnvelope({ ...m, body: '{"action":"read"}' }, pub, m.destination, m.time)
  ).toThrow();
  expect(() => verifyEnvelope(m, pub, "https://c.example", m.time)).toThrow();
  expect(() => verifyEnvelope(m, pub, m.destination, m.time + 300001)).toThrow();
  expect(() =>
    verifyEnvelope({ ...m, origin: "https://c.example" }, pub, m.destination, m.time)
  ).toThrow();
});
it("rejects unknown actions and extra control fields", () => {
  expect(() => packetBody.parse({ action: "ping", userId: "victim" })).toThrow();
  expect(() => packetBody.parse({ action: "dump" })).toThrow();
});
it("rejects unbounded/unknown permission expansions", () => {
  expect(() => scopeSchema.parse({ statistics: true, all: true })).toThrow();
});
