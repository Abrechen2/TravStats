import jwt, { SignOptions } from 'jsonwebtoken';
import { JWT_SECRET } from './jwtSecret';

const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Mint a session token.
 *
 * The `epoch` is the user's `sessionEpoch` at the moment of minting. Every
 * password change and reset bumps that counter, and `authenticate` refuses a
 * token whose epoch is behind — which is how a recovered account stops being
 * usable by whoever was already signed in (audit finding AUD-003).
 *
 * A counter, not a timestamp: `iat` is only accurate to the second, so a
 * time-based cutoff would keep honouring anything minted in the same second as
 * the change — including, on a busy instance, the session being revoked.
 *
 * Tokens minted before this claim existed carry no `epoch`, and are read as 0.
 * They keep working until that user's first password change, which is the
 * correct answer: nothing about them has been invalidated yet.
 */
export const generateToken = (userId: string, epoch = 0): string => {
  const options: SignOptions = { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign({ userId, epoch }, JWT_SECRET, options);
};

export const verifyToken = (token: string): { userId: string; epoch?: number } => {
  return jwt.verify(token, JWT_SECRET) as { userId: string; epoch?: number };
};
