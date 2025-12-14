import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  console.log('Auth Header:', authHeader); // Debug log
  const token = authHeader && authHeader.split(' ')[1];
  console.log('Token:', token); // Debug log

  if (!token) {
    console.log('No token found');
    return res.sendStatus(401);
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      console.log('Token verification failed:', err.message);
      return res.sendStatus(403);
    }
    // @ts-ignore
    req.user = user;
    next();
  });
};
