import { z } from "zod";
import { fetchRailJson, __clearRailHttpCache } from "../railHttp";
afterEach(() => {
  jest.restoreAllMocks();
  __clearRailHttpCache();
});
it("refreshes a cached timetable response and preserves the last success on failure", async () => {
  const fetchMock = jest
    .spyOn(global, "fetch")
    .mockResolvedValueOnce(new Response('{"value":1}'))
    .mockResolvedValueOnce(new Response('{"value":2}'))
    .mockResolvedValueOnce(new Response("{}", { status: 503 }));
  const schema = z.object({ value: z.number() });
  const get = (refresh = false) =>
    fetchRailJson("test", "https://transit.test/trip", schema, null, refresh);
  expect(await get()).toEqual({ ok: true, data: { value: 1 } });
  expect(await get()).toEqual({ ok: true, data: { value: 1 } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await get(true)).toEqual({ ok: true, data: { value: 2 } });
  expect(await get()).toEqual({ ok: true, data: { value: 2 } });
  expect(await get(true)).toEqual({ ok: false, reason: "failed" });
  expect(await get()).toEqual({ ok: true, data: { value: 2 } });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
