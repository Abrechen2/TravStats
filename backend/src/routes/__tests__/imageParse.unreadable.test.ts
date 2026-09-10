import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { validateBoardingPassImageBase64 } from "../../utils/fileValidation";

/**
 * A file the OCR cannot read is a client error, not the end of the service.
 *
 * `POST /parse-image` with a body Tesseract could not decode did not return an
 * error — it took the process down. tesseract.js rejects the pending promise
 * AND then does `throw Error(data)` from inside its own message callback when
 * no `errorHandler` was supplied, which is an uncaught exception on the main
 * thread; the default handler exits. Every other user saw a 502 from nginx
 * while the container restarted, so from outside it looked like a flaky
 * gateway rather than a crash (forgejo#117).
 *
 * The trigger was an ordinary mistake, not fuzzing: the image was sent as a
 * data URI instead of bare base64. The validator strips that prefix before
 * sniffing — so the payload validated cleanly — and the route then handed the
 * UNSTRIPPED string to the OCR, where base64 decoding skipped the prefix's
 * invalid characters and produced rubble in front of the image.
 *
 * The assertion that matters is the SECOND request: the process is still there.
 */
const USERNAME = `image-unreadable-${Date.now()}`;

/** A real 1x1 PNG — valid to the sniffer, far too small to read text from. */
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("an image the OCR cannot read", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("hands the caller the bytes it actually validated", () => {
    // The mismatch itself, without OCR: a data URI validates, and what comes
    // back is the payload WITHOUT the prefix. Passing the original on is what
    // fed the OCR rubble.
    const result = validateBoardingPassImageBase64(`data:image/png;base64,${PNG_1x1}`);

    expect(result.valid).toBe(true);
    expect(result.base64).toBe(PNG_1x1);
    expect(result.base64).not.toContain("data:");
  });

  it("still validates a bare payload unchanged", () => {
    const result = validateBoardingPassImageBase64(PNG_1x1);
    expect(result.valid).toBe(true);
    expect(result.base64).toBe(PNG_1x1);
  });

  it("answers rather than dying, twice in a row", async () => {
    // A data URI: the exact shape that crashed the beta three times.
    const body = { imageBase64: `data:image/png;base64,${PNG_1x1}`, domain: "auto" };

    const first = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", cookie)
      .send(body);

    // 422 for "cannot read this", or 422 for "almost no text" — both are the
    // route answering. What must NOT happen is a 5xx, and what must REALLY not
    // happen is the process going away.
    expect(first.status).toBeLessThan(500);

    const second = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", cookie)
      .send(body);

    // The proof: the app is still serving. Before the fix the first request
    // ended the process and there was nothing left to answer this one.
    expect(second.status).toBeLessThan(500);
  }, 60_000);
});
