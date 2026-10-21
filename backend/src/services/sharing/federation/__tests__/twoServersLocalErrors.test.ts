/**
 * A failure on one of the two servers themselves is not a transport failure (F-S4d review
 * leftover): an error in this server's own code or database while sending, and an error the
 * receiving server meets while applying a message, each reach the trip page as themselves —
 * retried, but never read as "the other server does not answer" and never turned into
 * `unreachable` after fourteen days. A failed DNS lookup still is a transport failure.
 */
import dnsPromises from "dns/promises";
import { servers, useTwoServers, type Server } from "./twoServerHarness";
import { DAY, editFlight, gateOf, membersOn, sharedFlight } from "./sharedTripFixtures";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

describe("an error that is not the network", () => {
  it("on the sending server: retried as a local error, never shown unreachable", async () => {
    const { anna, flight, trip, benFlight } = await sharedFlight(a, b);
    await editFlight(a, anna, flight.id, { gate: "B2" });
    const boom = jest
      .spyOn(a.security, "exchange")
      .mockRejectedValue(new Error("relation does not exist"));
    const t0 = new Date();
    expect(await a.outbox.runDeliveries(t0)).toMatchObject({ failed: 1 });
    const [member] = await membersOn(a, anna, trip.id);
    expect(member).toMatchObject({
      state: "active",
      delivery: { state: "retrying", reason: "local-error" },
    });
    await a.outbox.runDeliveries(new Date(t0.getTime() + 15 * DAY));
    expect((await membersOn(a, anna, trip.id))[0]).toMatchObject({
      state: "active",
      delivery: { state: "retrying", reason: "local-error" },
    });
    boom.mockRestore();
    await a.outbox.runDeliveries(new Date(t0.getTime() + 20 * DAY));
    expect(await gateOf(b, benFlight.id)).toBe("B2");
  });

  it("on the receiving server: answered as its error, retried, never shown unreachable", async () => {
    const { anna, flight, trip, benFlight } = await sharedFlight(a, b);
    await editFlight(a, anna, flight.id, { gate: "B2" });
    const adapter = b.adapters.ADAPTERS.flight;
    const broken = jest.spyOn(adapter, "apply").mockRejectedValue(new Error("disk full"));
    const t0 = new Date();
    expect(await a.outbox.runDeliveries(t0)).toMatchObject({ failed: 1 });
    expect((await membersOn(a, anna, trip.id))[0]).toMatchObject({
      state: "active",
      delivery: { state: "retrying", reason: "remote-error" },
    });
    await a.outbox.runDeliveries(new Date(t0.getTime() + 15 * DAY));
    expect((await membersOn(a, anna, trip.id))[0]).toMatchObject({
      state: "active",
      delivery: { state: "retrying", reason: "remote-error" },
    });
    broken.mockRestore();
    await a.outbox.runDeliveries(new Date(t0.getTime() + 20 * DAY));
    expect(await gateOf(b, benFlight.id)).toBe("B2");
  });

  it("a name that does not resolve stays a transport failure", async () => {
    const { anna, flight, trip } = await sharedFlight(a, b);
    await editFlight(a, anna, flight.id, { gate: "B2" });
    jest
      .spyOn(dnsPromises, "lookup")
      .mockRejectedValue(
        Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) as never
      );
    await a.outbox.runDeliveries();
    expect((await membersOn(a, anna, trip.id))[0].delivery).toMatchObject({
      state: "retrying",
      reason: "unreachable",
    });
  });
});
