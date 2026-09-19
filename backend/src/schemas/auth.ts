import { z } from "./zod";

/**
 * Usernames nobody may register, because something in the system already
 * means them.
 *
 * Today that is one name. `seedDemoAccount.ts` looks the shared demo account
 * up by `username = "demo"`, and until the data-integrity audit of 2026-09-19
 * (finding 1) it reset whatever it found: one boot with CREATE_DEMO_USER=true
 * published a real person's account as demo/demo123 and deleted their rows
 * from thirty tables. The seeder now refuses an account that is not flagged
 * `isDemo`, which closes the destruction; this list closes the collision, so
 * an instance never has to choose between its demo account and a user.
 *
 * Case-insensitive, because Postgres is not: `Demo` and `DEMO` are distinct
 * rows under the unique index, and either of them reads as the demo account
 * to a person looking at the user list.
 *
 * It reserves the name for NEW accounts only. An instance that already has a
 * user called `demo` keeps them — taking a name back from someone using it is
 * the very thing this exists to prevent.
 */
export const RESERVED_USERNAMES = ["demo"] as const;

export function isReservedUsername(username: string): boolean {
  const normalized = username.trim().toLowerCase();
  return RESERVED_USERNAMES.some((reserved) => reserved === normalized);
}

export const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(100),
});

// Admin-only payload for creating users programmatically (e.g. via admin
// PAT during AI-agent / automated onboarding). `isAdmin` defaults to false.
export const adminCreateUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(100),
  isAdmin: z.boolean().optional().default(false),
  notificationEmail: z.string().email().optional(),
});

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Old password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(100),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  username: z.string().min(1),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const forceChangePasswordSchema = z.object({
  changeToken: z.string().min(1).optional(), // now delivered via HttpOnly cookie; body is fallback
  newPassword: z.string().min(8).max(100),
});

export const adminResetPasswordSchema = z.object({
  mode: z.enum(["generate", "set"]),
  password: z.string().min(8).max(100).optional(),
  mustChangePassword: z.boolean().optional(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ForceChangePasswordInput = z.infer<typeof forceChangePasswordSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
