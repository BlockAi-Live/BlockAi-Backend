import type { Request, Response } from 'express';
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHAINGPT_API_KEY = process.env.CHAIN_GPT_API;
const CHAINGPT_URL = "https://api.chaingpt.org/chat/stream";

// Initialize Gemini (fallback / "BlockAI 3.0")
let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Chat handler — Supports ChainGPT (default) and Gemini ("blockai3") via `provider` param.
 */
export const chat = async (req: Request, res: Response) => {
    const { content, provider = "chaingpt" } = req.body;
    // @ts-ignore
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: "User not found" });

    // --- Route to correct provider ---
    if (provider === "blockai3" || provider === "gemini") {
        return handleGemini(req, res, content, userId);
    }

    // Default: ChainGPT
    return handleChainGPT(req, res, content, userId);
};

/**
 * ChainGPT — uses /chat/stream and reads the full streamed text response
 */
async function handleChainGPT(req: Request, res: Response, content: string, userId: string) {
    if (!CHAINGPT_API_KEY) {
        return res.status(500).json({ error: "ChainGPT API key not configured" });
    }

    try {
        console.log("[Chat] ChainGPT request...");
        
        const cgptResponse = await fetch(CHAINGPT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${CHAINGPT_API_KEY}`,
            },
            body: JSON.stringify({
                model: "general_assistant",
                question: content,
                chatHistory: "off",
            }),
        });

        if (!cgptResponse.ok) {
            const errText = await cgptResponse.text();
            console.error(`[Chat] ChainGPT failed (${cgptResponse.status}):`, errText);
            return res.status(cgptResponse.status).json({ error: "ChainGPT unavailable", detail: errText });
        }

        // Read entire response as text — ChainGPT stream endpoint returns plain text
        const answer = await cgptResponse.text();
        console.log("[Chat] ChainGPT success, length:", answer.length);

        // Award points (fire-and-forget)
        prisma.user.update({ where: { id: userId }, data: { points: { increment: 10 } } }).catch(() => {});
        prisma.usageLog.create({ data: { userId, action: "AI_CHAT_CHAINGPT", cost: 0 } }).catch(() => {});

        return res.json({ answer, provider: "chaingpt" });

    } catch (error: any) {
        console.error("[Chat] ChainGPT error:", error.message);
        return res.status(500).json({ error: error.message || "ChainGPT failed" });
    }
}

/**
 * Gemini — "BlockAI 3.0" mode
 */
async function handleGemini(req: Request, res: Response, content: string, userId: string) {
    if (!ai) {
        return res.status(500).json({ error: "BlockAI 3.0 unavailable (Gemini key not set)" });
    }

    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-exp", "gemini-flash-latest"];
    let lastError;

    for (const model of models) {
        try {
            console.log(`[Chat] BlockAI 3.0: Attempting ${model}...`);
            const response = await ai.models.generateContent({
                model,
                contents: [{
                    role: "user",
                    parts: [
                        { text: `SYSTEM INSTRUCTION: 
You are BlockAI 3.0, an advanced cryptocurrency and economics expert agent. 
Your goal is to provide helpful, accurate, and insightful analysis of crypto markets, blockchain technology, and economic trends. 
Assume the role of a knowledgeable market analyst.
IMPORTANT: If the user asks for prices, stats, or market data, PROVIDE THE DATA you have from your internal knowledge. Do NOT just tell them to check a website. 
You can mention that the data is based on your last training update, but you must still provide the numbers/estimates you have.
Always be helpful, concise, and professional. 
Encourage the user to ask about specific tokens, market sentiment, or technical analysis.` },
                        { text: content }
                    ]
                }],
            });

            // @ts-ignore
            const answer = response?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (answer) {
                prisma.user.update({ where: { id: userId }, data: { points: { increment: 10 } } }).catch(() => {});
                prisma.usageLog.create({ data: { userId, action: "AI_CHAT_GEMINI", cost: 0 } }).catch(() => {});
                return res.json({ answer, provider: "blockai3" });
            }
        } catch (error: any) {
            console.warn(`[Chat] Gemini ${model} failed:`, error.message);
            lastError = error;
        }
    }

    return res.status(500).json({ error: lastError?.message || "BlockAI 3.0 failed" });
}
