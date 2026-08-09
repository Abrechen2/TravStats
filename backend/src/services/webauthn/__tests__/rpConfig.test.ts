import { passkeyUnavailableReason } from "../rpConfig";

describe("passkeyUnavailableReason", () => {
  it("says not-configured when there is no origin at all", () => {
    expect(passkeyUnavailableReason(null)).toBe("notConfigured");
    expect(passkeyUnavailableReason("")).toBe("notConfigured");
  });

  it("accepts https", () => {
    expect(passkeyUnavailableReason("https://trav.example.com")).toBeNull();
  });

  // Browsers exempt localhost from the secure-context rule, so a dev machine
  // can use passkeys over plain http.
  it("accepts http on localhost", () => {
    expect(passkeyUnavailableReason("http://localhost:3000")).toBeNull();
    expect(passkeyUnavailableReason("http://127.0.0.1:8000")).toBeNull();
  });

  // A LAN IP over plain http is NOT a secure context. Offering a passkey button
  // there would produce a browser error the user cannot act on.
  it("refuses http on a LAN address", () => {
    expect(passkeyUnavailableReason("http://192.168.178.120:3010")).toBe("insecureOrigin");
    expect(passkeyUnavailableReason("http://travstats.local:3010")).toBe("insecureOrigin");
  });

  it("refuses something that is not a URL", () => {
    expect(passkeyUnavailableReason("not a url")).toBe("notConfigured");
  });
});
