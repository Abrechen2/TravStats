/**
 * Unit tests for DELETE /admin/users/:id guards — no DB required.
 * Verifies the self-delete block, last-admin block, 404 path, and the
 * happy path by mocking Prisma.
 */

import type { Request, Response, NextFunction } from "express";

const mockUserFindUnique = jest.fn();
const mockUserCount = jest.fn();
const mockUserDelete = jest.fn();
const mockSyncChangeDeleteMany = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      count: (...args: unknown[]) => mockUserCount(...args),
      delete: (...args: unknown[]) => mockUserDelete(...args),
    },
    syncChange: {
      deleteMany: (...args: unknown[]) => mockSyncChangeDeleteMany(...args),
    },
    // The array form: the operations were already started, so await them.
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The account-file step (forgejo#287) is exercised against real rows and files
// in services/files/__tests__/accountFiles.test.ts; here only its wiring.
const mockDeleteAccountWithFiles = jest.fn(
  async (_userId: string, deleteRows: () => Promise<unknown>) => deleteRows()
);
jest.mock("../services/files/accountFiles", () => ({
  deleteAccountWithFiles: (userId: string, deleteRows: () => Promise<unknown>) =>
    mockDeleteAccountWithFiles(userId, deleteRows),
}));

jest.mock("../services/emailService", () => ({
  sendAdminPasswordResetEmail: jest.fn(),
}));

interface MinimalAuthRequest extends Request {
  userId?: string;
  params: { id: string };
}

async function callDeleteRoute(req: MinimalAuthRequest): Promise<{
  status: number;
  body: unknown;
}> {
  // Lazy-import so the mocks above are in place first
  const router = (await import("../routes/admin/users")).default;

  // Find the delete handler on the router stack
  const layer = router.stack.find(
    (l) =>
      l.route?.path === "/users/:id" && l.route.stack.some((handler) => handler.method === "delete")
  );

  if (!layer?.route?.stack[0]?.handle) {
    throw new Error("DELETE /users/:id handler not found");
  }

  return new Promise((resolve) => {
    let statusCode = 200;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
    } as unknown as Response;

    const next: NextFunction = (err: unknown) => {
      if (err && typeof err === "object" && "statusCode" in err) {
        const e = err as { statusCode: number; message: string };
        resolve({ status: e.statusCode, body: { error: e.message } });
      } else {
        resolve({ status: 500, body: { error: String(err) } });
      }
    };

    (
      layer.route!.stack[0].handle as (
        req: Request,
        res: Response,
        next: NextFunction
      ) => void | Promise<void>
    )(req, res, next);
  });
}

describe("DELETE /admin/users/:id — guards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when admin tries to delete themselves", async () => {
    const req = {
      userId: "admin-1",
      params: { id: "admin-1" },
    } as MinimalAuthRequest;

    const res = await callDeleteRoute(req);
    expect(res.status).toBe(400);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("returns 404 when user is not found", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const req = {
      userId: "admin-1",
      params: { id: "ghost-user" },
    } as MinimalAuthRequest;

    const res = await callDeleteRoute(req);
    expect(res.status).toBe(404);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("returns 400 when deleting the last remaining admin", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "target-admin",
      username: "theonlyone",
      isAdmin: true,
    });
    mockUserCount.mockResolvedValue(1);

    const req = {
      userId: "admin-1",
      params: { id: "target-admin" },
    } as MinimalAuthRequest;

    const res = await callDeleteRoute(req);
    expect(res.status).toBe(400);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("deletes the user when caller is admin, target exists, and not last admin", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "target-user",
      username: "bob",
      isAdmin: false,
    });
    mockUserDelete.mockResolvedValue({ id: "target-user" });

    const req = {
      userId: "admin-1",
      params: { id: "target-user" },
    } as MinimalAuthRequest;

    const res = await callDeleteRoute(req);
    expect(res.status).toBe(200);
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: "target-user" } });
    expect(res.body).toEqual({ message: "User deleted", userId: "target-user" });
  });

  it("deletes the account through the step that also removes its uploaded files", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "target-user", username: "bob", isAdmin: false });
    mockUserDelete.mockResolvedValue({ id: "target-user" });

    const res = await callDeleteRoute({
      userId: "admin-1",
      params: { id: "target-user" },
    } as MinimalAuthRequest);

    expect(res.status).toBe(200);
    expect(mockDeleteAccountWithFiles).toHaveBeenCalledWith("target-user", expect.any(Function));
    expect(mockUserDelete).toHaveBeenCalledTimes(1);
    // The change log goes with the account (beta.23 UAT before 2.7.0-rc.20).
    expect(mockSyncChangeDeleteMany).toHaveBeenCalledWith({ where: { userId: "target-user" } });
  });

  it("guards refuse before any file is touched", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await callDeleteRoute({ userId: "admin-1", params: { id: "ghost" } } as MinimalAuthRequest);
    expect(mockDeleteAccountWithFiles).not.toHaveBeenCalled();
  });

  it("deletes an admin when other admins remain", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "target-admin-2",
      username: "secondary",
      isAdmin: true,
    });
    mockUserCount.mockResolvedValue(3);
    mockUserDelete.mockResolvedValue({ id: "target-admin-2" });

    const req = {
      userId: "admin-1",
      params: { id: "target-admin-2" },
    } as MinimalAuthRequest;

    const res = await callDeleteRoute(req);
    expect(res.status).toBe(200);
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: "target-admin-2" } });
  });
});
