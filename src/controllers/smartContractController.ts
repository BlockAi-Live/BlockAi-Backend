import type { Request, Response } from 'express';

const CHAINGPT_API_KEY = process.env.CHAIN_GPT_API;
const CHAINGPT_URL = "https://api.chaingpt.org/chat/stream";

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Smart Contract handler — Audit or Generate via ChainGPT
 * POST /api/v1/smart-contract
 * Body: { content: string, mode: "audit" | "generate" }
 */
export const smartContract = async (req: Request, res: Response) => {
    const { content, mode = "audit" } = req.body;
    // @ts-ignore
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!content?.trim()) return res.status(400).json({ error: "Content is required" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!CHAINGPT_API_KEY) {
        return res.status(500).json({ error: "ChainGPT API key not configured" });
    }

    const model = mode === "generate" ? "smart_contract_generator" : "smart_contract_auditor";
    const actionLog = mode === "generate" ? "SMART_CONTRACT_GENERATE" : "SMART_CONTRACT_AUDIT";

    try {
        console.log(`[SmartContract] ${mode} request using model: ${model}`);

        const cgptResponse = await fetch(CHAINGPT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${CHAINGPT_API_KEY}`,
            },
            body: JSON.stringify({
                model,
                question: content,
                chatHistory: "off",
            }),
        });

        if (!cgptResponse.ok) {
            const errText = await cgptResponse.text();
            console.error(`[SmartContract] ChainGPT failed (${cgptResponse.status}):`, errText);
            return res.status(cgptResponse.status).json({ error: "ChainGPT unavailable", detail: errText });
        }

        const answer = await cgptResponse.text();
        console.log(`[SmartContract] ${mode} success, length: ${answer.length}`);

        // Award points and log usage (fire-and-forget)
        prisma.user.update({ where: { id: userId }, data: { points: { increment: 15 } } }).catch(() => {});
        prisma.usageLog.create({ data: { userId, action: actionLog, cost: 0 } }).catch(() => {});

        return res.json({ answer, mode, model });

    } catch (error: any) {
        console.error(`[SmartContract] Error:`, error.message);
        return res.status(500).json({ error: error.message || "Smart contract request failed" });
    }
};
