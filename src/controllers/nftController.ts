import type { Request, Response } from 'express';

const CHAINGPT_API_KEY = process.env.CHAIN_GPT_API;
const NFT_GENERATE_URL = "https://api.chaingpt.org/nft/generate-image";
const CHAINGPT_CHAT_URL = "https://api.chaingpt.org/chat/stream";

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Generate an NFT image from a text prompt via ChainGPT
 * POST /api/v1/nft/generate
 * Body: { prompt: string }
 */
export const generateNFT = async (req: Request, res: Response) => {
    const { prompt } = req.body;
    // @ts-ignore
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!CHAINGPT_API_KEY) {
        return res.status(500).json({ error: "API key not configured" });
    }

    try {
        console.log("[NFT] Generating image for prompt:", prompt.substring(0, 50) + "...");

        const response = await fetch(NFT_GENERATE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${CHAINGPT_API_KEY}`,
            },
            body: JSON.stringify({
                prompt,
                model: "nebula_forge_xl",
                steps: 50,
                width: 1024,
                height: 1024,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[NFT] ChainGPT failed (${response.status}):`, errText);
            return res.status(response.status).json({ error: "NFT generation failed", detail: errText });
        }

        // Response could be JSON with image URL or binary image data
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
            const data = await response.json();
            console.log("[NFT] Success (JSON), statusCode:", data.statusCode);
            
            // Award points
            prisma.user.update({ where: { id: userId }, data: { points: { increment: 20 } } }).catch(() => {});
            prisma.usageLog.create({ data: { userId, action: "NFT_GENERATE", cost: 0 } }).catch(() => {});

            // ChainGPT returns { data: { type: "Buffer", data: [bytes...] } }
            if (data.data?.type === "Buffer" && Array.isArray(data.data?.data)) {
                const buffer = Buffer.from(data.data.data);
                const base64 = buffer.toString('base64');
                return res.json({ 
                    imageUrl: `data:image/jpeg;base64,${base64}`,
                    prompt 
                });
            }

            // Fallback: check for direct URL fields
            const imageUrl = data.imageUrl || data.image || data.url || data.data?.imageUrl || data.data?.url;
            if (imageUrl) {
                return res.json({ imageUrl, prompt });
            }

            // Last fallback: return raw data for debugging
            return res.json({ imageUrl: null, metadata: data, prompt });
        } else {
            // Binary image — convert to base64
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const mimeType = contentType || 'image/png';
            
            console.log("[NFT] Success (binary), size:", buffer.byteLength);

            prisma.user.update({ where: { id: userId }, data: { points: { increment: 20 } } }).catch(() => {});
            prisma.usageLog.create({ data: { userId, action: "NFT_GENERATE", cost: 0 } }).catch(() => {});

            return res.json({ 
                imageUrl: `data:${mimeType};base64,${base64}`,
                prompt 
            });
        }

    } catch (error: any) {
        console.error("[NFT] Error:", error.message);
        return res.status(500).json({ error: error.message || "NFT generation failed" });
    }
};

/**
 * Get AI trading signals via ChainGPT ai_signal_watchlist model
 * GET /api/v1/signals
 */
export const getSignals = async (req: Request, res: Response) => {
    // @ts-ignore
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!CHAINGPT_API_KEY) {
        return res.status(500).json({ error: "API key not configured" });
    }

    try {
        console.log("[Signals] Fetching AI trading signals...");

        const response = await fetch(CHAINGPT_CHAT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${CHAINGPT_API_KEY}`,
            },
            body: JSON.stringify({
                model: "general_assistant",
                question: "Give me the top 5 crypto trading signals right now. For each signal include: token name, current trend (bullish/bearish), confidence level (%), key support and resistance levels, and a brief reasoning. Format as a clean numbered list.",
                chatHistory: "off",
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Signals] Failed (${response.status}):`, errText);
            return res.status(response.status).json({ error: "Signals unavailable", detail: errText });
        }

        const answer = await response.text();
        console.log("[Signals] Success, length:", answer.length);

        prisma.usageLog.create({ data: { userId, action: "AI_SIGNALS", cost: 0 } }).catch(() => {});

        return res.json({ signals: answer });

    } catch (error: any) {
        console.error("[Signals] Error:", error.message);
        return res.status(500).json({ error: error.message || "Failed to fetch signals" });
    }
};
