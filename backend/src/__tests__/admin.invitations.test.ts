import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';

// Mock the email service BEFORE importing the app
const mockSendInvitationEmail = jest.fn<() => Promise<void>>();
jest.mock('../services/emailService', () => ({
  sendInvitationEmail: mockSendInvitationEmail,
  testSmtpConnection: jest.fn(),
}));

import { app } from '../index';
import { prisma } from '../db';
import { generateToken } from '../utils/jwt';

let adminUserId: string;
let adminToken: string;

async function createAdminUser(): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      username: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: 'x',
      isAdmin: true,
    },
  });
  return { id: user.id, token: generateToken(user.id) };
}

describe('admin/invitations — POST /', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    process.env.MAX_USERS = '10';
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;
  });

  afterEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a link-only invitation with expiresInDays', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.invitation.email).toBeNull();
    expect(res.body.invitation.token).toHaveLength(64);
    expect(res.body.inviteUrl).toContain(`?token=${res.body.invitation.token}`);

    const stored = await prisma.invitation.findUnique({
      where: { id: res.body.invitation.id },
    });
    expect(stored?.createdBy).toBe(adminUserId);
    expect(stored?.email).toBeNull();
  });

  it('rejects expiresInDays outside {1,7,30}', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 14 });

    expect(res.status).toBe(400);
  });

  it('returns 409 when user + active invite count >= MAX_USERS', async () => {
    process.env.MAX_USERS = '2';
    await prisma.invitation.create({
      data: {
        token: 'placeholder-token-1',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 7 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/user limit reached/i);
  });
});

describe('admin/invitations — POST /email', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    process.env.MAX_USERS = '10';
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;
  });

  it('creates an invitation and marks emailStatus=sent on SMTP success', async () => {
    mockSendInvitationEmail.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/v1/admin/invitations/email')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ email: 'jane@example.com', expiresInDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.emailError).toBeNull();
    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1);

    const stored = await prisma.invitation.findUnique({
      where: { id: res.body.invitation.id },
    });
    expect(stored?.email).toBe('jane@example.com');
    expect(stored?.emailStatus).toBe('sent');
    expect(stored?.emailSentAt).not.toBeNull();
  });

  it('creates an invitation and marks emailStatus=failed on SMTP throw', async () => {
    mockSendInvitationEmail.mockRejectedValue(new Error('SMTP auth failed'));

    const res = await request(app)
      .post('/api/v1/admin/invitations/email')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ email: 'jane@example.com', expiresInDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.emailError).toContain('SMTP auth failed');

    const stored = await prisma.invitation.findUnique({
      where: { id: res.body.invitation.id },
    });
    expect(stored?.emailStatus).toBe('failed');
    expect(stored?.emailError).toContain('SMTP auth failed');
  });

  it('rejects invalid email with 400', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations/email')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ email: 'not-an-email', expiresInDays: 7 });

    expect(res.status).toBe(400);
    expect(mockSendInvitationEmail).not.toHaveBeenCalled();
  });
});

describe('admin/invitations — POST /:id/resend', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;
  });

  it('resends an active invitation with email', async () => {
    mockSendInvitationEmail.mockResolvedValue(undefined);
    const invitation = await prisma.invitation.create({
      data: {
        email: 'jane@example.com',
        token: 'tok-active-with-email',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        emailStatus: 'failed',
        emailError: 'previous failure',
      },
    });

    const res = await request(app)
      .post(`/api/v1/admin/invitations/${invitation.id}/resend`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(true);
    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1);

    const updated = await prisma.invitation.findUnique({ where: { id: invitation.id } });
    expect(updated?.emailStatus).toBe('sent');
    expect(updated?.emailError).toBeNull();
  });

  it('returns 400 when invitation has no email', async () => {
    const invitation = await prisma.invitation.create({
      data: {
        token: 'tok-no-email',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post(`/api/v1/admin/invitations/${invitation.id}/resend`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no email/i);
  });

  it('returns 400 when invitation is already used', async () => {
    const usedBy = (await createAdminUser()).id;
    const invitation = await prisma.invitation.create({
      data: {
        email: 'jane@example.com',
        token: 'tok-used',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usedAt: new Date(),
        usedBy,
      },
    });

    const res = await request(app)
      .post(`/api/v1/admin/invitations/${invitation.id}/resend`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already used/i);
  });

  it('returns 400 when invitation is expired', async () => {
    const invitation = await prisma.invitation.create({
      data: {
        email: 'jane@example.com',
        token: 'tok-expired',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = await request(app)
      .post(`/api/v1/admin/invitations/${invitation.id}/resend`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('returns 404 on unknown id', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations/00000000-0000-0000-0000-000000000000/resend')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(404);
  });
});
