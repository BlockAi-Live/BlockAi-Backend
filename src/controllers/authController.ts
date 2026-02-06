import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const prisma = new PrismaClient();

if (!process.env.JWT_SECRET) {
    throw new Error("FATAL: JWT_SECRET environment variable is not set.");
}
const JWT_SECRET = process.env.JWT_SECRET;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().optional(),
  referralCode: z.string().optional(),
});

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Check for referrer
    let referrerId: string | null = null;
    const { referralCode } = req.body;
    if (referralCode) {
        const referrer = await prisma.user.findUnique({ where: { referralCode } });
        if (referrer) {
            referrerId = referrer.id;
        }
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
        fullName: fullName ?? null,
        referrerId: referrerId // Link referrer
      },
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

    res.json({ token, user: { 
        id: user.id, 
        email: user.email, 
        fullName: user.fullName,
        points: user.points,
        isAccessGranted: user.isAccessGranted 
    } });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Registration failed' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

    res.json({ token, user: { 
        id: user.id, 
        email: user.email, 
        fullName: user.fullName, 
        points: user.points,
        isAccessGranted: user.isAccessGranted
    } });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
};
// Wallet Login
export const walletLogin = async (req: Request, res: Response) => {
    try {
        const { walletAddress } = req.body;
        
        if (!walletAddress) {
             return res.status(400).json({ error: "Wallet address is required" });
        }

        const user = await prisma.user.findUnique({ where: { walletAddress } });
        
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

        res.json({ token, user: { 
            id: user.id, 
            email: user.email, 
            fullName: user.fullName, 
            walletAddress: user.walletAddress,
            points: user.points,
            isAccessGranted: user.isAccessGranted
        } });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
};

// Wallet Register
export const walletRegister = async (req: Request, res: Response) => {
    try {
        const { walletAddress, username } = req.body;

         if (!walletAddress || !username) {
             return res.status(400).json({ error: "Wallet address and username are required" });
        }

        const existingUser = await prisma.user.findUnique({ where: { walletAddress } });
        if (existingUser) {
            return res.status(400).json({ error: "Wallet already registered" });
        }

        // Check for referrer
        let referrerId: string | null = null;
        const { referralCode } = req.body;
        if (referralCode) {
             const referrer = await prisma.user.findUnique({ where: { referralCode } });
             if (referrer) {
                 referrerId = referrer.id;
             }
        }

        const user = await prisma.user.create({
            data: {
                walletAddress,
                fullName: username,
                email: null, 
                passwordHash: null,
                referrerId: referrerId // Link referrer
            }
        });

        // Initialize Billing State for new Wallet User
        await prisma.billingState.create({
            data: {
                userId: user.id,
                plan: "free",
                credits: 20
            }
        });

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

        res.json({ token, user: { id: user.id, email: user.email, fullName: user.fullName, walletAddress: user.walletAddress } });

    } catch (error) {
         res.status(400).json({ error: error instanceof Error ? error.message : 'Registration failed' });
    }
};

export const me = async (req: Request, res: Response) => {
  // @ts-ignore
  const userId = req.user?.userId;
  
  if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: { 
    id: user.id, 
    email: user.email, 
    fullName: user.fullName, 
    walletAddress: user.walletAddress,
    points: user.points,
    isAccessGranted: user.isAccessGranted
  } });
};

const updateProfileSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(2).optional(),
});

export const updateProfile = async (req: Request, res: Response) => {
  // @ts-ignore
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { email, fullName } = updateProfileSchema.parse(req.body);

    if (email) {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(email && { email }),
        ...(fullName && { fullName }),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        walletAddress: true,
        points: true,
        isAccessGranted: true,
      },
    });

    res.json({ user: updatedUser });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Update failed' });
  }
};

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6),
});

export const updatePassword = async (req: Request, res: Response) => {
  // @ts-ignore
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { currentPassword, newPassword } = updatePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid current password' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hashedPassword,
      },
    });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Password update failed' });
  }
};
