import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { readInterruptedKeySwap } from "../../services/backup/keySwapMarker";

jest.mock("../../services/backup/keySwapMarker", () => ({
  ...jest.requireActual("../../services/backup/keySwapMarker"),
  readInterruptedKeySwap: jest.fn(() => null),
}));
const interrupted = readInterruptedKeySwap as jest.MockedFunction<typeof readInterruptedKeySwap>;

/**
 * A restore that died while replacing the instance key raises a red admin item
 * (services/backup/keySwapMarker.ts). Before, nothing on the page said so: the
 * server came back with whichever key the file held and every stored
 * credential possibly unreadable.
 */
describe("readiness: admin.keySwapInterrupted", () => {
  let adminId: string;
  let userId: string;
  const item = async (id: string) =>
    (
      (await request(app).get("/api/v1/readiness").set("Cookie", `auth_token=${generateToken(id)}`))
        .body.items as Array<{ id: string; status: string; action: string | null }>
    ).find((i) => i.id === "admin.keySwapInterrupted");

  beforeAll(async () => {
    const stamp = Date.now();
    const mk = async (username: string, isAdmin: boolean) =>
      prisma.user.create({
        data: { username, passwordHash: await hashPassword("pw-123456"), isAdmin, isActive: true },
      });
    adminId = (await mk(`rdy_ks_admin_${stamp}`, true)).id;
    userId = (await mk(`rdy_ks_user_${stamp}`, false)).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  });

  it("is absent while no key swap was interrupted", async () => {
    interrupted.mockReturnValue(null);
    expect(await item(adminId)).toBeUndefined();
  });

  it("needs action while the marker of a dead swap is there, for admins only", async () => {
    interrupted.mockReturnValue({
      previousKeyCopy: "/x/encryption.key.before-restore-1",
      previousFingerprint: "p",
      archiveFingerprint: "a",
      startedAt: "2026-11-25T00:00:00.000Z",
      previousKeyCopyExists: true,
      inForce: "archive",
    });
    expect(await item(adminId)).toMatchObject({
      status: "needsAction",
      action: "/settings/sicherungen",
    });
    expect(await item(userId)).toBeUndefined();
  });
});
