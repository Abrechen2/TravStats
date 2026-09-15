import path from "path";

/**
 * Where the signed-in session lives between the setup project and the specs.
 *
 * Its own module because the Playwright config needs the path and must NOT
 * import a file that calls `test()` — doing so makes Playwright refuse the
 * whole config with "did not expect test() to be called here".
 */
export const STORAGE_STATE = path.join(__dirname, ".auth", "user.json");
