import crypto from "crypto";
import { request, type APIRequestContext } from "@playwright/test";

import { STORAGE_STATE } from "../storageState";

/**
 * Throw-away accounts for the auth-ladder specs (forgejo#56).
 *
 * Every account is created through the admin API with the session the setup
 * project stored, and deleted again by the spec that made it. Nothing here
 * touches the database directly: a spec that only works because it wrote a
 * row by hand has not tested the product.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * RFC 6238 TOTP — SHA-1, 30 s, 6 digits, the defaults every authenticator app
 * and the server's otplib use. Written out rather than imported so the E2E
 * tree gains no dependency just to compute six digits.
 */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/**
 * A code that stays valid long enough to be typed. Close to the end of a
 * 30-second step the page may submit after the server has moved on; waiting
 * for the next step costs at most five seconds and removes the flake.
 */
export async function freshTotp(secret: string): Promise<string> {
  const intoStep = (Date.now() / 1000) % 30;
  if (intoStep > 25) await new Promise((resolve) => setTimeout(resolve, (30 - intoStep + 0.5) * 1000));
  return totp(secret);
}

export async function adminApi(baseURL: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL, storageState: STORAGE_STATE });
}

export async function anonymousApi(baseURL: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL });
}

async function ok<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what}: HTTP ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export interface TestAccount {
  id: string;
  username: string;
  password: string;
  /** Present when two-factor was switched on for the account. */
  totpSecret?: string;
}

/** A plain account, created by the admin. */
export async function createAccount(admin: APIRequestContext, prefix: string): Promise<TestAccount> {
  const username = `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const password = `E2e-${crypto.randomBytes(9).toString("base64url")}`;
  const body = await ok<{ user: { id: string } }>(
    await admin.post("/api/v1/admin/users", { data: { username, password } }),
    "create account"
  );
  return { id: body.user.id, username, password };
}

/** Switch on two-factor for the account, the way the settings page does. */
export async function enableTwoFactor(baseURL: string, account: TestAccount): Promise<TestAccount> {
  const session = await anonymousApi(baseURL);
  try {
    await ok(
      await session.post("/api/v1/auth/login", {
        data: { username: account.username, password: account.password },
      }),
      "log in to enable two-factor"
    );
    const { secret } = await ok<{ secret: string }>(
      await session.post("/api/v1/auth/2fa/setup"),
      "start two-factor setup"
    );
    await ok(
      await session.post("/api/v1/auth/2fa/activate", { data: { code: await freshTotp(secret) } }),
      "activate two-factor"
    );
    return { ...account, totpSecret: secret };
  } finally {
    await session.dispose();
  }
}

/** The admin sets a password AND flags it for a forced change. */
export async function forcePasswordChange(
  admin: APIRequestContext,
  account: TestAccount
): Promise<TestAccount> {
  const password = `E2e-${crypto.randomBytes(9).toString("base64url")}`;
  await ok(
    await admin.post(`/api/v1/admin/users/${account.id}/reset-password`, {
      data: { mode: "set", password, mustChangePassword: true },
    }),
    "force a password change"
  );
  return { ...account, password };
}

export async function deleteAccount(admin: APIRequestContext, account: TestAccount | undefined): Promise<void> {
  if (!account) return;
  await admin.delete(`/api/v1/admin/users/${account.id}`);
}
