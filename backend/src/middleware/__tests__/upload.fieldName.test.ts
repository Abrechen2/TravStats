import express from "express";
import request from "supertest";
import { MulterError } from "multer";

import { uploadReceipt } from "../upload";

/**
 * GHSA-wc9g-mqfw-jrwm, fixed in multer 2.3.0.
 *
 * multer parses a field name like `a[3]` through append-field, which turns the
 * bracket group into an array index. The index is unbounded, so `a[4294967294]`
 * grows `req.body.a` to the maximum array length (2^32-1). A second field named
 * `a` then reaches append-field's `push()` on that full array, and push throws
 * `RangeError: Invalid array length`.
 *
 * The throw happens inside a busboy event, which is NOT on the call stack of
 * the Express request handler, so on the container runtime (Linux/Node 22) it
 * escaped as an uncaughtException and `index.ts` terminates the process on
 * those — a 147-byte authenticated upload took the whole app down. On
 * Windows/Node 24 the same error happened to reach Express and merely produced
 * a 500, which is why the crash was invisible on a developer machine and this
 * test asserts on the error VALUE rather than on a status code or a survived
 * process.
 *
 * multer 2.3.0 wraps the appendField call in try/catch and reports
 * `INVALID_FIELD_NAME` instead. Pinning that here means a downgrade below 2.3.0
 * fails the suite rather than the production container.
 */
describe("uploadReceipt — a hostile multipart field name cannot throw past Express", () => {
  const BOUNDARY = "----travstats-upload-fieldname-test";

  const hostileBody = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="a[4294967294]"\r\n\r\nx\r\n` +
      `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="a"\r\n\r\ny\r\n` +
      `--${BOUNDARY}--\r\n`,
  );

  /** Builds an app that records whatever error multer hands to Express. */
  function buildApp() {
    const seen: Error[] = [];
    const app = express();
    app.post("/receipt", uploadReceipt.single("receipt"), (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        seen.push(err);
        res.status(400).json({ error: err.message });
      },
    );
    return { app, seen };
  }

  it("reports a MulterError instead of letting RangeError escape", async () => {
    const { app, seen } = buildApp();

    await request(app)
      .post("/receipt")
      .set("Content-Type", `multipart/form-data; boundary=${BOUNDARY}`)
      .send(hostileBody);

    expect(seen).toHaveLength(1);
    const [err] = seen;

    // The regression itself: a RangeError here means multer is back below
    // 2.3.0 and the container runtime would have died instead of answering.
    expect(err).not.toBeInstanceOf(RangeError);
    expect(err.message).not.toBe("Invalid array length");

    expect(err).toBeInstanceOf(MulterError);
    expect((err as MulterError).code).toBe("INVALID_FIELD_NAME");
  });

  it("raises no unhandled exception while parsing that body", async () => {
    const escaped: Error[] = [];
    const onUncaught = (e: Error) => escaped.push(e);
    // Jest installs its own handler; ours only observes and does not replace it.
    process.on("uncaughtException", onUncaught);

    try {
      const { app } = buildApp();
      await request(app)
        .post("/receipt")
        .set("Content-Type", `multipart/form-data; boundary=${BOUNDARY}`)
        .send(hostileBody);
      // Give the busboy event loop a turn to surface a late throw.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("uncaughtException", onUncaught);
    }

    expect(escaped).toEqual([]);
  });

  it("still accepts an ordinary field name", async () => {
    const { app, seen } = buildApp();

    const res = await request(app)
      .post("/receipt")
      .field("note", "an ordinary value")
      .field("tags[0]", "first");

    expect(seen).toEqual([]);
    expect(res.status).toBe(200);
  });
});
