/**
 * Imported FIRST by a test that must run on a pool of one connection: an
 * answer that holds a transaction and then asks the global client for a
 * second connection waits for itself, and the test sees it as a timeout.
 */
const url = process.env.DATABASE_URL ?? "";
process.env.DATABASE_URL = /[?&]connection_limit=\d+/.test(url)
  ? url.replace(/connection_limit=\d+/, "connection_limit=1")
  : `${url}${url.includes("?") ? "&" : "?"}connection_limit=1`;

export {};
