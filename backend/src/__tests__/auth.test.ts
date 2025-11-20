import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('Auth API', () => {
  beforeAll(async () => {
    // Clean up test data
    await prisma.user.deleteMany({
      where: { username: { startsWith: 'testuser' } },
    });
  });

  afterAll(async () => {
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

      expect(response.body).toHaveProperty('token');
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

      expect(response.body).toHaveProperty('token');
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
