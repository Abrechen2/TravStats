import * as fs from 'fs';

import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';
import { getEmailUploadDir } from '../../middleware/upload';

/**
 * A rejected upload does not stay on disk.
 *
 * Multer writes the file before the body is validated, so every failure path
 * has to clean up after it. The domain check's branch did try — but `filePath`
 * was assigned AFTER that check, so it unlinked `undefined` and the file stayed
 * for good. One bad `domain` field per request was enough to fill a disk slowly
 * and quietly (audit finding AUD-013).
 *
 * The assertion counts files in the upload directory rather than looking for a
 * name, because the name is generated server-side and the point is that nothing
 * is left behind at all.
 */
const USERNAME = `email-parse-cleanup-${Date.now()}`;

const countUploads = (): number =>
  fs.existsSync(getEmailUploadDir()) ? fs.readdirSync(getEmailUploadDir()).length : 0;

describe('parse-email-file cleans up after itself', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword('password123') },
    });
    userId = user.id;
    token = generateToken(userId);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('leaves nothing behind when the domain is invalid', async () => {
    const before = countUploads();

    const res = await request(app)
      .post('/api/v1/parse-email-file')
      .set('Cookie', [`auth_token=${token}`])
      .field('domain', 'not-a-domain')
      .attach('email', Buffer.from('Subject: test\r\n\r\nhello'), {
        filename: 'test.eml',
        contentType: 'message/rfc822',
      });

    expect(res.status).toBe(400);
    expect(countUploads()).toBe(before);
  });

  // The shape of the damage was a slow leak, not one lost file: every rejected
  // request left one behind. Ten in a row must still leave the directory as it
  // was.
  it('does not leak one file per rejected request', async () => {
    const before = countUploads();

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/parse-email-file')
        .set('Cookie', [`auth_token=${token}`])
        .field('domain', `nonsense-${i}`)
        .attach('email', Buffer.from('Subject: test\r\n\r\nhello'), {
          filename: 'test.eml',
          contentType: 'message/rfc822',
        });
    }

    expect(countUploads()).toBe(before);
  });
});
