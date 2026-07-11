import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';
import { getProfilePictureDir } from '../../middleware/upload';

// Minimal valid PNG signature (8 bytes) followed by padding — the route only
// inspects the magic number, it never decodes a real image.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const validPngBuffer = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(64, 0)]);

// Minimal valid JPEG signature (3 bytes) followed by padding.
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const validJpegBuffer = Buffer.concat([JPEG_SIGNATURE, Buffer.alloc(64, 0)]);

// Plain text pretending to be a PNG (wrong magic number).
const fakePngBuffer = Buffer.from('this is not actually a png file, just text pretending');

describe('settings profile picture (#186)', () => {
  let token: string;
  let userId: string;
  let otherToken: string;
  let otherUserId: string;
  const uploadedFilenames: string[] = [];

  beforeAll(async () => {
    const timestamp = Date.now();
    const user = await prisma.user.create({
      data: {
        username: `profile-pic-${timestamp}`,
        passwordHash: await hashPassword('password123'),
        isAdmin: false,
        isActive: true,
      },
    });
    userId = user.id;
    token = generateToken(userId);

    const other = await prisma.user.create({
      data: {
        username: `profile-pic-other-${timestamp}`,
        passwordHash: await hashPassword('password123'),
        isAdmin: false,
        isActive: true,
      },
    });
    otherUserId = other.id;
    otherToken = generateToken(otherUserId);
  });

  afterAll(async () => {
    for (const filename of uploadedFilenames) {
      const filePath = path.join(getProfilePictureDir(), filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userId, otherUserId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('uploads a valid PNG and returns + persists a profilePictureUrl', async () => {
    const res = await request(app)
      .post('/api/v1/settings/profile-picture')
      .set('Cookie', [`auth_token=${token}`])
      .attach('profilePicture', validPngBuffer, 'avatar.png');

    expect(res.status).toBe(201);
    expect(typeof res.body.profilePictureUrl).toBe('string');
    expect(res.body.profilePictureUrl).toMatch(/^\/api\/v1\/settings\/profile-picture\//);

    const filename = res.body.profilePictureUrl.split('/').pop() as string;
    uploadedFilenames.push(filename);

    const settingsRes = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`]);
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.profile.profilePicture).toBe(res.body.profilePictureUrl);
  });

  it('uploads a valid JPEG and returns a profilePictureUrl', async () => {
    const res = await request(app)
      .post('/api/v1/settings/profile-picture')
      .set('Cookie', [`auth_token=${token}`])
      .attach('profilePicture', validJpegBuffer, 'avatar.jpg');

    expect(res.status).toBe(201);
    const filename = res.body.profilePictureUrl.split('/').pop() as string;
    uploadedFilenames.push(filename);
  });

  it('deletes the previous avatar file when a new one is uploaded', async () => {
    const first = await request(app)
      .post('/api/v1/settings/profile-picture')
      .set('Cookie', [`auth_token=${token}`])
      .attach('profilePicture', validPngBuffer, 'first.png');
    const firstFilename = first.body.profilePictureUrl.split('/').pop() as string;
    const firstPath = path.join(getProfilePictureDir(), firstFilename);
    expect(fs.existsSync(firstPath)).toBe(true);

    const second = await request(app)
      .post('/api/v1/settings/profile-picture')
      .set('Cookie', [`auth_token=${token}`])
      .attach('profilePicture', validJpegBuffer, 'second.jpg');
    const secondFilename = second.body.profilePictureUrl.split('/').pop() as string;
    uploadedFilenames.push(secondFilename);

    expect(fs.existsSync(firstPath)).toBe(false);
  });

  it('rejects a file whose magic number does not match the declared image type', async () => {
    const res = await request(app)
      .post('/api/v1/settings/profile-picture')
      .set('Cookie', [`auth_token=${token}`])
      .attach('profilePicture', fakePngBuffer, 'fake.png');

    expect(res.status).toBe(400);
  });

  it('rejects an oversized file server-side', async () => {
    const oversized = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(6 * 1024 * 1024, 0)]);
    const res = await request(app)
      .post('/api/v1/settings/profile-picture')
      .set('Cookie', [`auth_token=${token}`])
      .attach('profilePicture', oversized, 'huge.png');

    expect(res.status).toBe(400);
  }, 20000);

  it('user A cannot GET user B avatar', async () => {
    const upload = await request(app)
      .post('/api/v1/settings/profile-picture')
      .set('Cookie', [`auth_token=${token}`])
      .attach('profilePicture', validPngBuffer, 'owned-by-a.png');
    const filename = upload.body.profilePictureUrl.split('/').pop() as string;
    uploadedFilenames.push(filename);

    const res = await request(app)
      .get(`/api/v1/settings/profile-picture/${filename}`)
      .set('Cookie', [`auth_token=${otherToken}`]);
    expect(res.status).toBe(404);

    const ownRes = await request(app)
      .get(`/api/v1/settings/profile-picture/${filename}`)
      .set('Cookie', [`auth_token=${token}`]);
    expect(ownRes.status).toBe(200);
  });

  describe('PUT /settings profilePicture value validation', () => {
    it('accepts a same-origin path', async () => {
      const res = await request(app)
        .put('/api/v1/settings')
        .set('Cookie', [`auth_token=${token}`])
        .send({ profile: { profilePicture: '/api/v1/settings/profile-picture/abc.png' } });
      expect(res.status).toBe(200);
    });

    it('accepts an http(s) URL', async () => {
      const res = await request(app)
        .put('/api/v1/settings')
        .set('Cookie', [`auth_token=${token}`])
        .send({ profile: { profilePicture: 'https://example.com/avatar.png' } });
      expect(res.status).toBe(200);
    });

    it('rejects a blob: URL', async () => {
      const res = await request(app)
        .put('/api/v1/settings')
        .set('Cookie', [`auth_token=${token}`])
        .send({ profile: { profilePicture: 'blob:http://localhost:3000/abc-123' } });
      expect(res.status).toBe(400);
    });

    it('rejects a data: URL', async () => {
      const res = await request(app)
        .put('/api/v1/settings')
        .set('Cookie', [`auth_token=${token}`])
        .send({ profile: { profilePicture: 'data:image/png;base64,AAAA' } });
      expect(res.status).toBe(400);
    });
  });
});
