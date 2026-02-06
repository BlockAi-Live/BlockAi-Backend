
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Track a successful referral (called after minting)
export const processMintReferral = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const { txHash } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get the current user to find their referrer
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { referrerId: true }
        });

        if (!user || !user.referrerId) {
            // No referrer linked to this user, nothing to track
            return res.status(200).json({ message: 'No referrer linked' });
        }

        // Increment the referrer's count
        await prisma.user.update({
            where: { id: user.referrerId },
            data: {
                referralCount: {
                    increment: 1
                }
            }
        });

        return res.status(200).json({ success: true, message: 'Referral tracked' });

    } catch (error) {
        console.error('Referral processing error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// Get stats for the dashboard
export const getReferralStats = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                referralCode: true,
                referralCount: true,
                fullName: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate a code if one doesn't exist (fallback)
        let code = user.referralCode;
        if (!code) {
            code = user.fullName?.toLowerCase().replace(/\s+/g, '') || `user${userId.substring(0,6)}`;
            // Try to save it, ignoring unique constraint errors if lazy
            try {
                await prisma.user.update({
                    where: { id: userId },
                    data: { referralCode: code }
                });
            } catch (e) {
                // If collision, append random string
                code = `${code}${Math.floor(Math.random() * 1000)}`;
                await prisma.user.update({
                  where: { id: userId },
                  data: { referralCode: code }
                });
            }
        }

        return res.json({
            referralCode: code,
            referralCount: user.referralCount
        });

    } catch (error) {
        console.error('Referral stats error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
