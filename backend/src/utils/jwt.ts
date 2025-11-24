import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './jwtSecret';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export const generateToken = (userId: string): string => {
  return jwt.sign({ userId } as any, JWT_SECRET as any, { expiresIn: JWT_EXPIRES_IN } as any);
};

export const verifyToken = (token: string): { userId: string } => {
  return jwt.verify(token, JWT_SECRET as any) as { userId: string };
};
