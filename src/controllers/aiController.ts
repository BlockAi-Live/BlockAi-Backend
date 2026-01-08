import type { Request, Response } from 'express';
import { GoogleGenAI } from "@google/genai";
import { X402Service } from '../services/x402Service';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize GenAI
let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const chat = async (req: Request, res: Response) => {
    // 1. Extract Details
    const { content } = req.body;
    // @ts-ignore
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // --- Access Guard ---
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!user.isAccessGranted) {
         return res.status(403).json({ 
             error: "Access Restricted",
             requiresAccessCode: true 
         });
    }

    // 2. Enforce X402 Billing (Optional Layer)
    // skipping distinct billing guard for now as verifyAccessCode is the primary gate
    
    if (!ai) {
        return res.status(500).json({ error: "AI Service Unavailable (Key not set)" });
    }

    // 4. Generate Content with Fallback Models
    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-exp", "gemini-flash-latest"];
    let lastError;
    let aiAnswer = "No response";
    let success = false;

    for (const model of models) {
        try {
            console.log(`Attempting to generate with model: ${model}`);
            const response = await ai.models.generateContent({
                model: model,
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: `SYSTEM INSTRUCTION: 
You are BlockAI, an advanced cryptocurrency and economics expert agent. 
Your goal is to provide helpful, accurate, and insightful analysis of crypto markets, blockchain technology, and economic trends. 
Assume the role of a knowledgeable market analyst.
IMPORTANT: If the user asks for prices, stats, or market data, PROVIDE THE DATA you have from your internal knowledge. Do NOT just tell them to check a website. 
You can mention that the data is based on your last training update, but you must still provide the numbers/estimates you have.
Always be helpful, concise, and professional. 
Encourage the user to ask about specific tokens, market sentiment, or technical analysis.` },
                        { text: content }
                        ]
                    }
                ],
            });

            // @ts-ignore
            if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                // @ts-ignore
                aiAnswer = response.candidates[0].content.parts[0].text;
                success = true;
                break; // Exit loop on success
            }

        } catch (error: any) {
            console.warn(`Model ${model} failed:`, error.message);
            lastError = error;
        }
    }

    if (success) {
        // --- Points Logic ---
        try {
            await prisma.user.update({
                where: { id: userId },
                data: { points: { increment: 10 } }
            });
        } catch (err) {
            console.error("Failed to update points:", err);
        }

        return res.json({ answer: aiAnswer });
    }

    // If all failed
    console.error("All AI models failed.");
    return res.status(500).json({ error: lastError?.message || "AI Generation Failed after retries" });
};
