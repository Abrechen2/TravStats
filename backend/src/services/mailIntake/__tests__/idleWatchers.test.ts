import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import dns from "dns";

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { encrypt } from "../../../utils/encryption";
import { updatePolicy } from "../../externalServices/policy";
import { activeWatcherCount, ensureWatchers, stopWatchers } from "../idleWatchers";
import { FakeMailbox } from "./helpers";

class WatchingMailbox extends FakeMailbox {
  watchers: Array<{ onNew: () => void; signal: AbortSignal }> = [];
  override async watch(_c: unknown, onNew: () => void, signal: AbortSignal): Promise<void> {
    this.watchers.push({ onNew, signal });
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
  }
}

describe("IDLE watchers", () => {
  let userId: string;
  const prefix = `idle-${Date.now()}`;

  beforeAll(async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockImplementation((async () => [{ address: "93.184.216.34", family: 4 }]) as never);
    userId = (
      await prisma.user.create({
        data: { username: prefix, passwordHash: await hashPassword("password123") },
      })
    ).id;
  });
  beforeEach(async () => {
    await prisma.mailIntakeSource.deleteMany({});
    await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((x) => x !== "mailIntake") }));
  });
  afterEach(() => stopWatchers());
  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.mailIntakeSource.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const mk = (over: Record<string, unknown> = {}) =>
    prisma.mailIntakeSource.create({
      data: {
        kind: "imap_folder",
        userId,
        host: "h",
        port: 993,
        username: "u",
        passwordEncrypted: encrypt("pw"),
        folder: "F",
        enabled: true,
        ...over,
      },
    });

  it("opens one watcher per enabled, usable source — and none for an off or credential-less one", async () => {
    const box = new WatchingMailbox();
    await mk();
    await ensureWatchers(box);
    await ensureWatchers(box); // idempotent
    expect(box.watchers).toHaveLength(1);
    expect(activeWatcherCount()).toBe(1);

    stopWatchers();
    await prisma.mailIntakeSource.update({ where: { userId }, data: { enabled: false } });
    await ensureWatchers(box);
    expect(box.watchers).toHaveLength(1);

    await prisma.mailIntakeSource.update({
      where: { userId },
      data: { enabled: true, passwordEncrypted: null },
    });
    await ensureWatchers(box);
    expect(box.watchers).toHaveLength(1);
  });

  it("opens none while the admin has the service switched off", async () => {
    const box = new WatchingMailbox();
    await mk();
    await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "mailIntake"] }));
    await ensureWatchers(box);
    expect(box.watchers).toHaveLength(0);
  });

  it("closes a running watcher once its source is switched off or the admin disables the service", async () => {
    const box = new WatchingMailbox();
    await mk();
    await ensureWatchers(box);
    expect(activeWatcherCount()).toBe(1);
    await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "mailIntake"] }));
    await ensureWatchers(box);
    expect(box.watchers[0].signal.aborted).toBe(true);
    expect(activeWatcherCount()).toBe(0);
  });

  it("aborts its connections on stop", async () => {
    const box = new WatchingMailbox();
    await mk();
    await ensureWatchers(box);
    stopWatchers();
    expect(box.watchers[0].signal.aborted).toBe(true);
    expect(activeWatcherCount()).toBe(0);
  });
});
