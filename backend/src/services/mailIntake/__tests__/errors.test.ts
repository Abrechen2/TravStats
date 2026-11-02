import { describe, it, expect } from "@jest/globals";
import { classifyImapError, MailIntakeError } from "../errors";

describe("classifyImapError — every failure keeps its own reason", () => {
  const cases: Array<[string, unknown, string]> = [
    ["refused connection", { code: "ECONNREFUSED" }, "connection_refused"],
    ["unknown host", { code: "ENOTFOUND" }, "host_not_found"],
    ["timeout by code", { code: "ETIMEDOUT" }, "timeout"],
    ["timeout by message", new Error("Socket timeout"), "timeout"],
    ["certificate error", { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "tls_error"],
    [
      "TLS on a plain port",
      new Error("error:0A00010B:SSL routines::wrong version number"),
      "tls_error",
    ],
    ["wrong password", { authenticationFailed: true }, "auth_failed"],
    ["missing folder (flag)", { mailboxMissing: true }, "folder_missing"],
    ["missing folder (response code)", { serverResponseCode: "NONEXISTENT" }, "folder_missing"],
    ["missing folder (text)", new Error("Mailbox doesn't exist: TravStats"), "folder_missing"],
    ["anything else", new Error("weird"), "protocol_error"],
    [
      "our own kind passes through",
      new MailIntakeError("credentials_missing"),
      "credentials_missing",
    ],
  ];
  it.each(cases)("%s", (_name, error, kind) => {
    expect(classifyImapError(error)).toBe(kind);
  });
});
