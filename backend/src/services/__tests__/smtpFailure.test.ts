import { describe, it, expect } from "@jest/globals";
import { smtpFailureCode } from "../smtpFailure";

const err = (props: Record<string, unknown>, message = "x"): Error =>
  Object.assign(new Error(message), props);

describe("smtpFailureCode — the SMTP test answers a stable code, never the server's text", () => {
  it("maps a refused login to SMTP_AUTH", () => {
    expect(smtpFailureCode(err({ code: "EAUTH", responseCode: 535 }, "Invalid login"))).toBe(
      "SMTP_AUTH"
    );
  });
  it("maps a failed handshake to SMTP_TLS even though it surfaces as ESOCKET", () => {
    expect(
      smtpFailureCode(
        err({ code: "ESOCKET", cause: { code: "ERR_SSL_WRONG_VERSION_NUMBER" } }, "wrong version")
      )
    ).toBe("SMTP_TLS");
    expect(smtpFailureCode(err({ code: "ETLS" }))).toBe("SMTP_TLS");
    expect(smtpFailureCode(err({ code: "ESOCKET" }, "self-signed certificate"))).toBe("SMTP_TLS");
  });
  it("maps a silent server to SMTP_TIMEOUT", () => {
    expect(smtpFailureCode(err({ code: "ETIMEDOUT" }, "Connection timeout"))).toBe("SMTP_TIMEOUT");
  });
  it("maps an unreachable host to SMTP_CONNECTION", () => {
    expect(smtpFailureCode(err({ code: "ECONNECTION" }, "connect ECONNREFUSED 10.0.0.1:25"))).toBe(
      "SMTP_CONNECTION"
    );
    expect(smtpFailureCode(err({ code: "EDNS" }))).toBe("SMTP_CONNECTION");
  });
  it("keeps everything else apart as SMTP_UNKNOWN", () => {
    expect(smtpFailureCode(new Error("boom"))).toBe("SMTP_UNKNOWN");
    expect(smtpFailureCode(null)).toBe("SMTP_UNKNOWN");
  });
});
