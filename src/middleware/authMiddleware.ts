import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set.");
}
const JWT_SECRET = process.env.JWT_SECRET;

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  console.log('Auth Header:', authHeader); // Debug log
  const token = authHeader && authHeader.split(' ')[1];
  console.log('Token:', token); // Debug log

  if (!token) {
    console.log('No token found');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      console.log('Token verification failed:', err.message);
      return res.status(403).json({ error: 'Forbidden' });
    }
    // @ts-ignore
    req.user = user;
    next();
  });
};
