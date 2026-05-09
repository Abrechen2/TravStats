import { z } from 'zod';

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
  oldPassword: z.string().min(1, 'Old password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(100),
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
  mode: z.enum(['generate', 'set']),
  password: z.string().min(8).max(100).optional(),
  mustChangePassword: z.boolean().optional(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ForceChangePasswordInput = z.infer<typeof forceChangePasswordSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
