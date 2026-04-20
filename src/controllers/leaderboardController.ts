import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getLeaderboard = async (req: Request, res: Response) => {
  try {
    // Fetch top users ordered by points (descending)
    const users = await prisma.user.findMany({
      orderBy: { points: 'desc' },
      take: 50,
      select: {
        id: true,
        fullName: true,
        walletAddress: true,
        points: true,
        createdAt: true,
      },
    });

    const leaderboard = users.map((u, i) => ({
      rank: i + 1,
      id: u.id,
      name: u.fullName || truncateAddress(u.walletAddress) || 'Anonymous',
      avatar: getAvatar(u.fullName, u.walletAddress),
      points: u.points,
      change: 0, // TODO: track rank history for deltas
    }));

    return res.json({ users: leaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
};

function truncateAddress(addr: string | null): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getAvatar(name: string | null, wallet: string | null): string {
  if (name && name.length >= 2) return name.substring(0, 2).toUpperCase();
  if (wallet) return wallet.slice(2, 4).toUpperCase();
  return 'AN';
}
