import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { X402Service } from '../services/x402Service';

const prisma = new PrismaClient();

// 1. The 402Resource Endpoint
export const getprotectedResource = async (req: Request, res: Response) => {
    const apiKey = req.headers['x-api-key'] as string;
    // @ts-ignore
    const walletAddress = req.body.walletAddress || req.user?.walletAddress;

    const access = await X402Service.accessGuard(apiKey, walletAddress);

    if (!access.allowed) {
        return res.status(402).json({
            error: "Payment Required",
            reason: access.reason,
            paymentInfo: access.paymentInfo
        });
    }

    // Success - Return the "premium" resource
    return res.json({
        message: "Access Granted: Premium Resource Data",
        data: {
            market_sentiment: "BULLISH",
            alpha: "Buy blocking tokens now.",
            timestamp: new Date()
        }
    });
};

// 2. Generate API Key
export const createApiKey = async (req: Request, res: Response) => {
    // @ts-ignore
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const key = await prisma.aPIKey.create({
        data: {
            userId,
            name: req.body.name || "Default Key"
        }
    });

    return res.json({ apiKey: key.key, id: key.id });
};

// 3. Process Mock Payment (Simulator)
export const simulatePayment = async (req: Request, res: Response) => {
    const { txHash, walletAddress } = req.body;
    // @ts-ignore
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const result = await X402Service.mockProcessPayment(
        txHash || "0xMOCKTX_" + Date.now(), 
        walletAddress || "0x0000000000000000000000000000000000000000", 
        userId
    );

    return res.json(result);
};

// 4. Get Dashboard Stats
export const getBillingStats = async (req: Request, res: Response) => {
    // @ts-ignore
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const billing = await X402Service.getBilling(userId);
    const keys = await prisma.aPIKey.findMany({ where: { userId } });
    const payments = await prisma.payment.findMany({ where: { userId } });

    return res.json({
        billing,
        keys,
        payments
    });
};
