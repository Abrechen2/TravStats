import http from "http";
import type { AddressInfo } from "net";
import { gzipSync } from "zlib";

import { __setFetchDeadlineForTests, fetchReceiverTrack, type Receiver } from "../receiverFetch";
import { DAY_START_S, cruiseRows, traceFile } from "./traceFixtures";

/**
 * The byte and time bounds on a REAL socket (no axios mock): what a receiver
 * announces (Content-Length, gzip) must not decide how much the server reads,
 * and a slow drip must be cut at the overall deadline.
 */
const FROM = DAY_START_S * 1000;
const OVER_FILE_LIMIT = 31 * 1024 * 1024;

describe("fetchReceiverTrack on the wire", () => {
  let server: http.Server;
  let receiver: Receiver;
  let handler: http.RequestListener;

  beforeAll(async () => {
    server = http.createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    receiver = {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      policy: { allowPrivate: true },
    };
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  afterEach(() => __setFetchDeadlineForTests(null));

  it("reads a good file", async () => {
    handler = (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(traceFile(cruiseRows(1800, 61))));
    };
    const result = await fetchReceiverTrack(receiver, "3c6444", FROM + 1800_000, FROM + 5400_000);
    expect(result.ok).toBe(true);
  });

  it("an oversized body is too_large whatever the headers announce (chunked, no Content-Length)", async () => {
    // A receiver cannot make Node's HTTP parser accept more than it announced, so the
    // announcement that matters is its absence (and gzip, below): the cap is on bytes received.
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(Buffer.alloc(OVER_FILE_LIMIT, 0x20));
    };
    const result = await fetchReceiverTrack(receiver, "3c6444", FROM, FROM + 3_600_000);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("counts bytes after decompression: a small gzip that inflates past the limit is too_large", async () => {
    const bomb = gzipSync(Buffer.alloc(OVER_FILE_LIMIT, 0x20));
    expect(bomb.length).toBeLessThan(100_000);
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "application/json" });
      res.end(bomb);
    };
    const result = await fetchReceiverTrack(receiver, "3c6444", FROM, FROM + 3_600_000);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("spends the bytes of a file that turns out not to be a trace", async () => {
    handler = (_req, res) => res.end("<html>nope</html>");
    const result = await fetchReceiverTrack(receiver, "3c6444", FROM, FROM + 3_600_000);
    expect(result).toEqual({ ok: false, reason: "bad_trace" });
  });

  it("cuts a slow drip at the overall deadline instead of waiting for it to finish", async () => {
    __setFetchDeadlineForTests(400);
    let timer: NodeJS.Timeout | undefined;
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // One byte every 100 ms keeps the socket "active", so an idle timeout never fires.
      timer = setInterval(() => res.write(" "), 100);
      res.on("close", () => clearInterval(timer));
    };
    const started = Date.now();
    const result = await fetchReceiverTrack(receiver, "3c6444", FROM, FROM + 3_600_000);
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
    clearInterval(timer);
  });
});
