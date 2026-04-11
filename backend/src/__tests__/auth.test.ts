import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('Auth API', () => {
  beforeEach(async () => {
    // Wipe all users and invitations so each register call hits the
    // isFirstUser=true bypass (ALLOW_REGISTRATION=false in test env).
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser1',
          password: 'password123',
        })
        .expect(201);

      // Token should be in HttpOnly cookie, not in body
      expect(response.headers['set-cookie']).toBeDefined();
      expect(response.headers['set-cookie'][0]).toContain('auth_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe('testuser1');
    });

    it('should reject duplicate username', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser2',
          password: 'password123',
        })
        .expect(201);

      await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser2',
          password: 'password123',
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login existing user', async () => {
      // First create user
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser3',
          password: 'password123',
        });

      // Then login
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testuser3',
          password: 'password123',
        })
        .expect(200);

      // Token should be in HttpOnly cookie, not in body
      expect(response.headers['set-cookie']).toBeDefined();
      expect(response.headers['set-cookie'][0]).toContain('auth_token');
      expect(response.body).toHaveProperty('user');
    });

    it('should reject invalid credentials', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'testuser3',
          password: 'wrongpassword',
        })
        .expect(401);
    });
  });
});
