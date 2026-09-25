/**
 * A stand-in for global `fetch` in the open data tests: each call is answered
 * by the first route whose pattern matches the URL, and every call is
 * recorded. An unmatched URL fails the test loudly instead of reaching the
 * network.
 */

type Answer = unknown | ((url: string, init?: RequestInit) => unknown);

export interface FetchMock {
  calls: string[];
  restore: () => void;
}

export function mockFetch(routes: ReadonlyArray<readonly [RegExp, Answer, number?]>): FetchMock {
  const calls: string[] = [];
  const spy = jest
    .spyOn(global, "fetch")
    .mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      const route = routes.find(([pattern]) => pattern.test(url));
      if (!route) throw new Error(`Unexpected fetch in test: ${url}`);
      const [, answer, status = 200] = route;
      const body = typeof answer === "function" ? answer(url, init) : answer;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
  return { calls, restore: () => spy.mockRestore() };
}
