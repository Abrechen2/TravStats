import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../index';
import { prisma } from '../db';

describe('POST /auth/register — invitation notificationEmail auto-fill', () => {
  beforeEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
  });

  it('populates notificationEmail from invitation email', async () => {
    const admin = await prisma.user.create({
      data: { username: 'admin', passwordHash: 'x', isAdmin: true },
    });
    await prisma.invitation.create({
      data: {
        email: 'jane@example.com',
        token: 'tok-fillemail',
        createdBy: admin.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'jane', password: 'password1234', invitationToken: 'tok-fillemail' });

    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { username: 'jane' } });
    expect(user?.notificationEmail).toBe('jane@example.com');
  });

  it('leaves notificationEmail null when invitation had no email', async () => {
    const admin = await prisma.user.create({
      data: { username: 'admin', passwordHash: 'x', isAdmin: true },
    });
    await prisma.invitation.create({
      data: {
        token: 'tok-noemail',
        createdBy: admin.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'john', password: 'password1234', invitationToken: 'tok-noemail' });

    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { username: 'john' } });
    expect(user?.notificationEmail).toBeNull();
  });
});
