import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// --- Public Endpoints ---

// POST /api/access/waitlist
export const joinWaitlist = async (req: Request, res: Response) => {
  try {
    const { email, walletAddress, telegram, twitter, reason } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const existing = await prisma.waitlist.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "Email already on waitlist" });
    }

    const entry = await prisma.waitlist.create({
      data: {
        email,
        walletAddress,
        telegram,
        twitter,
        reason
      }
    });

    res.json({ success: true, message: "Added to waitlist", entry });
  } catch (error) {
    console.error("Waitlist error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /api/access/redeem
export const redeemCode = async (req: Request, res: Response) => {
  try {
    const { code, userId } = req.body;

    if (!code || !userId) {
      return res.status(400).json({ error: "Code and UserID are required" });
    }

    // 1. Find Code
    const accessCode = await prisma.accessCode.findUnique({ where: { code } });

    if (!accessCode) {
      return res.status(404).json({ error: "Invalid access code" });
    }

    if (!accessCode.isActive) {
      return res.status(403).json({ error: "Access code is inactive" });
    }

    if (accessCode.usedCount >= accessCode.maxUses) {
      return res.status(403).json({ error: "Access code has reached max uses" });
    }

    // 2. Grant Access to User
    await prisma.$transaction([
        prisma.user.update({
            where: { id: userId },
            data: { isAccessGranted: true }
        }),
        prisma.accessCode.update({
            where: { id: accessCode.id },
            data: { usedCount: { increment: 1 } }
        })
    ]);

    res.json({ success: true, message: "Access granted successfully" });
  } catch (error) {
    console.error("Redeem error:", error);
    res.status(500).json({ error: "Failed to redeem code" });
  }
};

// --- Admin Endpoints ---

// GET /api/admin/waitlist
export const getWaitlist = async (req: Request, res: Response) => {
    try {
        // In production, add Admin Middleware Check here
        const list = await prisma.waitlist.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(list);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
};

// POST /api/admin/invite
export const generateInvite = async (req: Request, res: Response) => {
    try {
        const { code, maxUses } = req.body;
        // In production, add Admin Middleware Check here

        const newCode = await prisma.accessCode.create({
            data: {
                code: code || `AI-${Math.random().toString(36).substring(7).toUpperCase()}`,
                maxUses: maxUses || 1
            }
        });
        
        res.json(newCode);
    } catch (error) {
        res.status(500).json({ error: "Failed to create invite code" });
    }
};

// POST /api/admin/approve
export const approveWaitlist = async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: "ID is required" });

        const updated = await prisma.waitlist.update({
            where: { id },
            data: { status: "APPROVED" }
        });

        res.json({ success: true, entry: updated });
    } catch (error) {
        res.status(500).json({ error: "Failed to approve entry" });
    }
};
