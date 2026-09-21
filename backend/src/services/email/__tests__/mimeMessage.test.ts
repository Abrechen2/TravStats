import { extractEmailFromFile } from "../../emailExtractor";
import { parseMimeMessage } from "../mimeMessage";

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/**
 * Measured 2026-09-20 on 2.7.0-beta.13 (audit SRV-MAIL-MIME-001): a
 * standards-conformant multipart/mixed .eml with a text/plain part and a PDF
 * attachment came back from /parse-email-file with MIME boundaries, part
 * headers and base64 inside `text`. Python's stdlib parser read the same file
 * correctly, so this is not an exotic message.
 */
function eml(lines: string[]): Buffer {
  return Buffer.from(lines.join("\r\n"), "latin1");
}

const PDF_BASE64 = Buffer.from("%PDF-1.4 fake attachment bytes").toString("base64");

const MULTIPART_MIXED = eml([
  "From: Airline Booking <noreply@airline.example>",
  "To: traveller@example.org",
  "Subject: Your booking QA7T3T",
  "Date: Thu, 10 Jul 2025 08:15:00 +0200",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="travstats-outer"',
  "",
  "This is a multi-part message in MIME format.",
  "--travstats-outer",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: 7bit",
  "",
  "Flight LH2230 from MUC to CDG on 10.07.2025.",
  "Booking reference QA7T3T.",
  "",
  "--travstats-outer",
  'Content-Type: application/pdf; name="ticket.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="ticket.pdf"',
  "",
  PDF_BASE64,
  "--travstats-outer--",
  "",
]);

describe("reading a multipart booking mail", () => {
  it("gives the message text, not the MIME envelope", () => {
    const extracted = extractEmailFromFile(MULTIPART_MIXED, "booking.eml");

    expect(extracted.text).toContain("Flight LH2230 from MUC to CDG");
    expect(extracted.text).not.toContain("travstats-outer");
    expect(extracted.text).not.toContain("Content-Transfer-Encoding");
    expect(extracted.text).not.toContain(PDF_BASE64);
  });

  it("keeps the attachment as an attachment rather than as message text", () => {
    const message = parseMimeMessage(MULTIPART_MIXED);

    expect(message.attachments).toEqual([
      { filename: "ticket.pdf", mediaType: "application/pdf", size: 30 },
    ]);
  });

  it("still reads the headers the parser chain depends on", () => {
    const extracted = extractEmailFromFile(MULTIPART_MIXED, "booking.eml");

    expect(extracted.subject).toBe("Your booking QA7T3T");
    expect(extracted.from).toBe("noreply@airline.example");
    expect(extracted.sentAt?.toISOString()).toBe("2025-07-10T06:15:00.000Z");
  });

  it("reads a nested multipart/alternative and prefers its plain part", () => {
    const nested = eml([
      "Subject: Nested",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Plain body with flight LH2230.",
      "--inner",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body><p>HTML body with flight LH2230.</p></body></html>",
      "--inner--",
      "",
      "--outer--",
      "",
    ]);

    const extracted = extractEmailFromFile(nested, "nested.eml");

    expect(extracted.text).toContain("Plain body with flight LH2230.");
    expect(extracted.text).not.toContain("<p>");
    expect(extracted.html).toContain("<p>HTML body with flight LH2230.</p>");
  });

  it("decodes a quoted-printable German body instead of shipping =C3=BC", () => {
    const qp = eml([
      "Subject: =?utf-8?Q?Buchungsbest=C3=A4tigung?=",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Fr=C3=BChst=C3=BCck inklusive. Abflug am 10.07.2025 um 08:15 Uhr in M=C3=",
      "=BCnchen.",
      "",
    ]);

    const extracted = extractEmailFromFile(qp, "qp.eml");

    expect(extracted.subject).toBe("Buchungsbestätigung");
    expect(extracted.text).toContain("Frühstück inklusive");
    expect(extracted.text).toContain("München");
    expect(extracted.text).not.toContain("=C3");
  });

  it("decodes a latin-1 part with the charset it declares", () => {
    const latin1 = Buffer.concat([
      Buffer.from(
        [
          "Subject: Latin",
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=iso-8859-1",
          "",
          "",
        ].join("\r\n"),
        "latin1"
      ),
      Buffer.from("Abflug München", "latin1"),
    ]);

    expect(extractEmailFromFile(latin1, "latin1.eml").text).toBe("Abflug München");
  });

  it("keeps a folded subject whole", () => {
    const folded = eml([
      "Subject: Your booking confirmation for flight LH2230",
      "\tfrom Munich to Paris",
      "Content-Type: text/plain",
      "",
      "body",
      "",
    ]);

    expect(extractEmailFromFile(folded, "folded.eml").subject).toBe(
      "Your booking confirmation for flight LH2230 from Munich to Paris"
    );
  });

  it("still reads a plain single-part mail exactly as before", () => {
    const plain = eml([
      "From: noreply@airline.example",
      "Subject: Simple",
      "",
      "Flight LH2230 from MUC to CDG.",
      "",
    ]);

    const extracted = extractEmailFromFile(plain, "plain.eml");

    expect(extracted.text).toBe("Flight LH2230 from MUC to CDG.");
    expect(extracted.subject).toBe("Simple");
    expect(extracted.from).toBe("noreply@airline.example");
  });

  it("still reads markup that a body merely contains, with no content type to say so", () => {
    const inline = eml([
      "Subject: Inline markup",
      "",
      "<html><body><p>Flight LH2230 from MUC to CDG.</p></body></html>",
      "",
    ]);

    const extracted = extractEmailFromFile(inline, "inline.eml");

    expect(extracted.html).toContain("<p>Flight LH2230 from MUC to CDG.</p>");
    expect(extracted.text).toContain("Flight LH2230 from MUC to CDG.");
    expect(extracted.text).not.toContain("<p>");
  });
});
