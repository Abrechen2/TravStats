import { z } from 'zod';

export const EXPIRES_IN_DAYS = z.union([z.literal(1), z.literal(7), z.literal(30)]);

export const createLinkInvitationSchema = z.object({
  expiresInDays: EXPIRES_IN_DAYS.optional().default(7),
});

export const createEmailInvitationSchema = z.object({
  email: z.string().email('Invalid email address'),
  expiresInDays: EXPIRES_IN_DAYS.optional().default(7),
});

export const listInvitationsQuerySchema = z.object({
  status: z.enum(['all', 'active', 'used', 'expired']).optional().default('active'),
});

export type CreateLinkInvitationInput = z.infer<typeof createLinkInvitationSchema>;
export type CreateEmailInvitationInput = z.infer<typeof createEmailInvitationSchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;
