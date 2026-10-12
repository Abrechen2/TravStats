jest.mock("ws", () => {
  const { EventEmitter } = jest.requireActual("events");
  return class FakeSocket extends EventEmitter {
    static sockets: FakeSocket[] = [];
    send = jest.fn();
    terminate = jest.fn();
    constructor(..._args: unknown[]) {
      super();
      FakeSocket.sockets.push(this);
    }
  };
});
import WebSocket from "ws";
import { decodePosition, lookupVessel } from "../aisStream";
const sockets = () =>
  (
    WebSocket as unknown as {
      sockets: Array<{
        emit: (event: string, ...args: unknown[]) => void;
        send: jest.Mock;
        terminate: jest.Mock;
      }>;
    }
  ).sockets;
const frame = (mmsi = 211123456) => ({
  MessageType: "PositionReport",
  MetaData: { MMSI: mmsi, ShipName: "TEST FERRY", Latitude: 54, Longitude: 10 },
  Message: { PositionReport: { UserID: mmsi, Valid: true, Sog: 12.3, Cog: 84 } },
});
afterEach(() => {
  delete process.env.AISSTREAM_API_KEY;
  jest.useRealTimers();
});
it("works without a key by returning notConfigured, never opening a socket", async () => {
  delete process.env.AISSTREAM_API_KEY;
  expect(await lookupVessel("211123456")).toEqual({ status: "notConfigured", position: null });
  expect(sockets()).toHaveLength(0);
});
it("distinguishes receipt time from missing observation time", () => {
  expect(decodePosition(frame(), "211123456", 0)).toMatchObject({
    lat: 54,
    lon: 10,
    observedAt: null,
    receivedAt: "1970-01-01T00:00:00.000Z",
  });
});
it("ignores other vessels, invalid coordinates and AIS sentinel speed/course", () => {
  expect(decodePosition(frame(), "211999999")).toBeNull();
  const bad = frame();
  bad.MetaData.Latitude = 91;
  expect(decodePosition(bad, "211123456")).toBeNull();
  const sentinels = frame();
  sentinels.Message.PositionReport.Sog = 102.3;
  sentinels.Message.PositionReport.Cog = 360;
  expect(decodePosition(sentinels, "211123456")).toMatchObject({
    speedKnots: null,
    courseDegrees: null,
  });
});
it("coalesces requests, subscribes to one MMSI, closes after a valid report and caches it", async () => {
  process.env.AISSTREAM_API_KEY = "test-only-key";
  const a = lookupVessel("211123457"),
    b = lookupVessel("211123457");
  const socket = sockets().at(-1)!;
  socket.emit("open");
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
    FiltersShipMMSI: ["211123457"],
    FilterMessageTypes: ["PositionReport"],
  });
  socket.emit("message", Buffer.from(JSON.stringify(frame(211123457))));
  expect((await a).status).toBe("ok");
  expect(await b).toEqual(await a);
  expect(socket.terminate).toHaveBeenCalledTimes(1);
  const count = sockets().length;
  expect(await lookupVessel("211123457")).toEqual(await a);
  expect(sockets()).toHaveLength(count);
});
it("bounds wait time and rejects extra concurrent sockets", async () => {
  jest.useFakeTimers();
  process.env.AISSTREAM_API_KEY = "test-only-key";
  const a = lookupVessel("211123458"),
    b = lookupVessel("211123459");
  expect((await lookupVessel("211123460")).status).toBe("busy");
  await jest.advanceTimersByTimeAsync(15000);
  expect((await a).status).toBe("noSignal");
  expect((await b).status).toBe("noSignal");
});
it("does not return a provider error that could contain credentials", async () => {
  process.env.AISSTREAM_API_KEY = "test-only-key";
  const result = lookupVessel("211123461");
  sockets()
    .at(-1)!
    .emit("message", Buffer.from(JSON.stringify({ error: "test-only-key invalid" })));
  expect(await result).toEqual({ status: "unavailable", position: null });
});
