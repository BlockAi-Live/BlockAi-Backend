import type { Request, Response } from 'express';

const CHAINGPT_API_KEY = process.env.CHAIN_GPT_API;
const CHAINGPT_NEWS_URL = "https://api.chaingpt.org/news";

/**
 * Proxy ChainGPT AI News API
 * GET /api/v1/news?limit=5&categoryId=5
 */
export const getNews = async (req: Request, res: Response) => {
    if (!CHAINGPT_API_KEY) {
        return res.status(500).json({ error: "ChainGPT API key not configured" });
    }

    try {
        const { limit = "5", categoryId } = req.query;
        
        let url = `${CHAINGPT_NEWS_URL}?limit=${limit}`;
        if (categoryId) {
            url += `&categoryId=${categoryId}`;
        }

        const response = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${CHAINGPT_API_KEY}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[News] ChainGPT news failed (${response.status}):`, errText);
            return res.status(response.status).json({ error: "Failed to fetch news" });
        }

        const data = await response.json();
        return res.json(data);
    } catch (error: any) {
        console.error("[News] Error:", error.message);
        return res.status(500).json({ error: "Failed to fetch news" });
    }
};
