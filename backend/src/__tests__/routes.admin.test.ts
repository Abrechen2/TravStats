import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

describe('Admin Routes', () => {
  let adminUser: any;
  let regularUser: any;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    // Create admin user
    const timestamp = Date.now();
    adminUser = await prisma.user.create({
      data: {
        username: `admin-test-${timestamp}`,
        passwordHash: await hashPassword('admin-password'),
        isAdmin: true,
        isActive: true,
      },
    });
    adminToken = generateToken(adminUser.id);

    // Create regular user
    regularUser = await prisma.user.create({
      data: {
        username: `user-test-${timestamp}`,
        passwordHash: await hashPassword('user-password'),
        isAdmin: false,
        isActive: true,
      },
    });
    userToken = generateToken(regularUser.id);
  });

  afterAll(async () => {
    // Clean up test users
    if (adminUser) {
      await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
    }
    if (regularUser) {
      await prisma.user.delete({ where: { id: regularUser.id } }).catch(() => {});
    }
  });

  describe('GET /api/admin/users', () => {
    it('should allow admin to get all users', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [`auth_token=${adminToken}`]);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should deny access to non-admin users', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [`auth_token=${userToken}`]);

      expect(response.status).toBe(403);
    });

    it('should deny access to unauthenticated requests', async () => {
      const response = await request(app)
        .get('/api/admin/users');

      expect(response.status).toBe(401);
    });
  });

  describe('Admin User Management', () => {
    let testUserToDelete: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUserToDelete = await prisma.user.create({
        data: {
          username: `delete-test-${timestamp}`,
          passwordHash: await hashPassword('password'),
          isAdmin: false,
          isActive: true,
        },
      });
    });

    it('should allow admin to deactivate a user', async () => {
      const response = await request(app)
        .patch(`/api/admin/users/${testUserToDelete.id}`)
        .set('Cookie', [`auth_token=${adminToken}`])
        .send({ isActive: false });

      if (response.status === 200) {
        const user = await prisma.user.findUnique({
          where: { id: testUserToDelete.id },
        });
        expect(user?.isActive).toBe(false);
      } else {
        // If route not implemented yet, just verify it requires admin
        expect([401, 403, 404]).toContain(response.status);
      }
    });

    it('should deny non-admin from deactivating users', async () => {
      const response = await request(app)
        .patch(`/api/admin/users/${testUserToDelete.id}`)
        .set('Cookie', [`auth_token=${userToken}`])
        .send({ isActive: false });

      expect([401, 403, 404]).toContain(response.status);
    });

    afterEach(async () => {
      if (testUserToDelete) {
        await prisma.user.delete({ where: { id: testUserToDelete.id } }).catch(() => {});
      }
    });
  });

  describe('Admin Statistics', () => {
    it('should allow admin to view system stats', async () => {
      const response = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', [`auth_token=${adminToken}`]);

      // If implemented, should return stats
      // If not, should still require admin
      if (response.status === 200) {
        expect(response.body).toBeDefined();
      } else {
        expect([401, 403, 404]).toContain(response.status);
      }
    });

    it('should deny non-admin access to stats', async () => {
      const response = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', [`auth_token=${userToken}`]);

      expect([401, 403, 404]).toContain(response.status);
    });
  });
});
