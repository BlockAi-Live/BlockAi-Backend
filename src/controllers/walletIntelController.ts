import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";
const CHAINGPT_API_KEY = process.env.CHAIN_GPT_API;
const CHAINGPT_URL = "https://api.chaingpt.org/chat/stream";

// ---------- Etherscan helpers ----------

async function etherscanCall(params: Record<string, string>) {
    const url = new URL(ETHERSCAN_BASE);
    url.searchParams.set("apikey", ETHERSCAN_API_KEY || "");
    url.searchParams.set("chainid", "1"); // Ethereum mainnet
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString());
    const json = await res.json();
    return json;
}

async function getEthBalance(address: string): Promise<string> {
    const data = await etherscanCall({
        module: "account", action: "balance", address, tag: "latest",
    });
    const result = data.result;
    // Guard: if result is not a valid numeric string, return 0
    if (!result || typeof result !== "string" || !/^\d+$/.test(result)) {
        console.warn("[WalletIntel] Invalid balance result:", result);
        return "0.0000";
    }
    const wei = BigInt(result);
    return (Number(wei) / 1e18).toFixed(4);
}

async function getNormalTxns(address: string, limit = 25) {
    const data = await etherscanCall({
        module: "account", action: "txlist", address,
        startblock: "0", endblock: "99999999",
        page: "1", offset: String(limit), sort: "desc",
    });
    return Array.isArray(data.result) ? data.result : [];
}

async function getTokenTransfers(address: string, limit = 25) {
    const data = await etherscanCall({
        module: "account", action: "tokentx", address,
        startblock: "0", endblock: "99999999",
        page: "1", offset: String(limit), sort: "desc",
    });
    return Array.isArray(data.result) ? data.result : [];
}

async function getERC20Balances(address: string) {
    // Etherscan doesn't have a direct "all token balances" endpoint on free tier.
    // We extract unique tokens from recent transfers and note them.
    const transfers = await getTokenTransfers(address, 50);
    const tokenMap = new Map<string, { name: string; symbol: string; decimals: string; lastSeen: string }>();
    
    for (const tx of transfers) {
        if (!tokenMap.has(tx.contractAddress)) {
            tokenMap.set(tx.contractAddress, {
                name: tx.tokenName,
                symbol: tx.tokenSymbol,
                decimals: tx.tokenDecimal,
                lastSeen: new Date(Number(tx.timeStamp) * 1000).toISOString().split("T")[0] || "",
            });
        }
    }
    return Array.from(tokenMap.entries()).map(([addr, info]) => ({
        contract: addr,
        ...info,
    }));
}

async function getInternalTxns(address: string, limit = 10) {
    const data = await etherscanCall({
        module: "account", action: "txlistinternal", address,
        startblock: "0", endblock: "99999999",
        page: "1", offset: String(limit), sort: "desc",
    });
    return Array.isArray(data.result) ? data.result : [];
}

// ---------- Build wallet data summary ----------

function buildWalletSummary(
    address: string,
    ethBalance: string,
    txns: any[],
    tokenTransfers: any[],
    tokens: any[],
    internalTxns: any[],
) {
    const txCount = txns.length;
    const firstTx = txns.length > 0 ? txns[txns.length - 1] : null;
    const lastTx = txns.length > 0 ? txns[0] : null;

    const firstDate = firstTx ? new Date(Number(firstTx.timeStamp) * 1000).toISOString().split("T")[0] : "Unknown";
    const lastDate = lastTx ? new Date(Number(lastTx.timeStamp) * 1000).toISOString().split("T")[0] : "Unknown";

    // Calculate total ETH sent/received
    let totalSent = 0, totalReceived = 0;
    for (const tx of txns) {
        const val = Number(tx.value) / 1e18;
        if (tx.from.toLowerCase() === address.toLowerCase()) totalSent += val;
        else totalReceived += val;
    }

    // Unique interacted addresses
    const uniqueAddresses = new Set<string>();
    for (const tx of txns) {
        uniqueAddresses.add(tx.from.toLowerCase());
        uniqueAddresses.add(tx.to?.toLowerCase());
    }
    uniqueAddresses.delete(address.toLowerCase());

    // Contract interactions
    const contractInteractions = txns.filter(tx => tx.to && tx.input && tx.input !== "0x").length;

    // Token summary
    const tokenSummary = tokens.slice(0, 15).map(t => `- ${t.name} (${t.symbol}) — last seen ${t.lastSeen}`).join("\n");

    // Recent txn summary
    const recentTxSummary = txns.slice(0, 10).map(tx => {
        const date = new Date(Number(tx.timeStamp) * 1000).toISOString().split("T")[0];
        const val = (Number(tx.value) / 1e18).toFixed(4);
        const direction = tx.from.toLowerCase() === address.toLowerCase() ? "SENT" : "RECEIVED";
        const to = tx.to ? `${tx.to.substring(0, 10)}...` : "Contract Creation";
        const isContract = tx.input && tx.input !== "0x" ? " [CONTRACT CALL]" : "";
        return `- ${date} | ${direction} ${val} ETH → ${to}${isContract}`;
    }).join("\n");

    return `
WALLET ADDRESS: ${address}
ETH BALANCE: ${ethBalance} ETH

=== OVERVIEW ===
Total Recent Transactions: ${txCount} (showing last 25)
First Transaction Date: ${firstDate}
Last Transaction Date: ${lastDate}
Unique Addresses Interacted: ${uniqueAddresses.size}
Contract Interactions: ${contractInteractions} out of ${txCount} transactions
Total ETH Sent (recent): ${totalSent.toFixed(4)} ETH
Total ETH Received (recent): ${totalReceived.toFixed(4)} ETH
Internal Transactions: ${internalTxns.length}

=== TOKEN ACTIVITY (${tokens.length} tokens found) ===
${tokenSummary || "No token transfers found"}

=== RECENT TRANSACTIONS ===
${recentTxSummary || "No transactions found"}
    `.trim();
}

// ---------- Main endpoint ----------

export const analyzeWallet = async (req: Request, res: Response) => {
    const { address } = req.body;
    // @ts-ignore
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!address?.trim()) return res.status(400).json({ error: "Wallet address is required" });

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({ error: "Invalid Ethereum address format" });
    }

    if (!ETHERSCAN_API_KEY) {
        return res.status(500).json({ error: "Etherscan API key not configured" });
    }
    if (!CHAINGPT_API_KEY) {
        return res.status(500).json({ error: "AI API key not configured" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: "User not found" });

    try {
        console.log("[WalletIntel] Fetching data for:", address);

        // Helper to delay between Etherscan calls (free tier: 5 calls/sec)
        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

        // Fetch sequentially to avoid rate limits (3 calls/sec on free tier)
        const ethBalance = await getEthBalance(address);
        await delay(350);
        const txns = await getNormalTxns(address, 25);
        await delay(350);
        const tokenTransfers = await getTokenTransfers(address, 50);
        await delay(350);
        const internalTxns = await getInternalTxns(address, 10);

        // Extract token list from transfers
        const tokenMap = new Map<string, { name: string; symbol: string; decimals: string; lastSeen: string }>();
        for (const tx of tokenTransfers) {
            if (!tokenMap.has(tx.contractAddress)) {
                tokenMap.set(tx.contractAddress, {
                    name: tx.tokenName,
                    symbol: tx.tokenSymbol,
                    decimals: tx.tokenDecimal,
                    lastSeen: new Date(Number(tx.timeStamp) * 1000).toISOString().split("T")[0] || "",
                });
            }
        }
        const tokens = Array.from(tokenMap.entries()).map(([addr, info]) => ({ contract: addr, ...info }));

        console.log(`[WalletIntel] Data: ${ethBalance} ETH, ${txns.length} txns, ${tokens.length} tokens`);

        // Build the summary
        const walletData = buildWalletSummary(address, ethBalance, txns, tokenTransfers, tokens, internalTxns);

        // Send to ChainGPT for analysis
        console.log("[WalletIntel] Sending to AI for analysis...");

        const aiPrompt = `You are BlockAI Wallet Intelligence, an advanced on-chain analysis engine. Analyze the following wallet data and generate a comprehensive intelligence report.

${walletData}

Generate a detailed report with these sections, using markdown formatting:

## 🔍 Wallet Overview
Summary of the wallet — age, balance, activity level. Is this a whale, a retail trader, a bot, or a dormant wallet?

## 💰 Holdings Analysis
Break down the token holdings. What types of tokens are they holding? Any notable or risky tokens? Diversity assessment.

## 📊 Activity Patterns
Transaction frequency, peak activity periods, average transaction sizes. Is the wallet active or dormant? Any unusual spikes?

## ⚠️ Risk Assessment
Rate the wallet's risk level (Low / Medium / High / Critical) based on:
- Interaction with known risky contracts
- Token diversity
- Transaction patterns
- Any red flags

## 🐋 Whale & Notable Interactions
Identify any high-value transactions or interactions with notable contracts/addresses. Any DeFi protocol interactions?

## 🏦 DeFi Activity
Based on contract interactions and token transfers, identify any DeFi protocol usage (Uniswap, Aave, Compound, etc.)

## 📝 Summary & Recommendations
A brief executive summary with key takeaways and recommendations for anyone monitoring this wallet.

Be specific with numbers, dates, and addresses where possible. If data is limited, note that and still provide your best analysis based on what's available.`;

        const cgptResponse = await fetch(CHAINGPT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${CHAINGPT_API_KEY}`,
            },
            body: JSON.stringify({
                model: "general_assistant",
                question: aiPrompt,
                chatHistory: "off",
            }),
        });

        if (!cgptResponse.ok) {
            const errText = await cgptResponse.text();
            console.error("[WalletIntel] AI failed:", errText);
            return res.status(500).json({ error: "AI analysis failed", detail: errText });
        }

        const aiReport = await cgptResponse.text();
        console.log("[WalletIntel] AI report generated, length:", aiReport.length);

        // Award points
        prisma.user.update({ where: { id: userId }, data: { points: { increment: 25 } } }).catch(() => {});
        prisma.usageLog.create({ data: { userId, action: "WALLET_INTEL", cost: 0 } }).catch(() => {});

        return res.json({
            report: aiReport,
            rawData: {
                address,
                ethBalance,
                txCount: txns.length,
                tokenCount: tokens.length,
                tokens: tokens.slice(0, 10),
                internalTxCount: internalTxns.length,
            },
        });

    } catch (error: any) {
        console.error("[WalletIntel] Error:", error.message);
        return res.status(500).json({ error: error.message || "Wallet analysis failed" });
    }
};

// ---------- Transaction Decoder ----------

async function getTxDetails(txHash: string) {
    const data = await etherscanCall({
        module: "proxy", action: "eth_getTransactionByHash", txhash: txHash,
    });
    return data.result || null;
}

async function getTxReceipt(txHash: string) {
    const data = await etherscanCall({
        module: "proxy", action: "eth_getTransactionReceipt", txhash: txHash,
    });
    return data.result || null;
}

async function getTxTokenTransfers(txHash: string) {
    // We can't filter by tx hash directly, but we can get logs from the receipt
    // For now, we'll rely on the receipt logs
    return [];
}

function hexToDecimal(hex: string): string {
    if (!hex || hex === "0x") return "0";
    try { return BigInt(hex).toString(); } catch { return "0"; }
}

function hexToEth(hex: string): string {
    if (!hex || hex === "0x") return "0";
    try { return (Number(BigInt(hex)) / 1e18).toFixed(6); } catch { return "0"; }
}

export const decodeTx = async (req: Request, res: Response) => {
    const { txHash } = req.body;
    // @ts-ignore
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!txHash?.trim()) return res.status(400).json({ error: "Transaction hash is required" });

    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return res.status(400).json({ error: "Invalid transaction hash format" });
    }

    if (!ETHERSCAN_API_KEY) return res.status(500).json({ error: "Etherscan API key not configured" });
    if (!CHAINGPT_API_KEY) return res.status(500).json({ error: "AI API key not configured" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: "User not found" });

    try {
        console.log("[TxDecoder] Decoding tx:", txHash);

        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

        const txDetails = await getTxDetails(txHash);
        await delay(400);
        const txReceipt = await getTxReceipt(txHash);

        if (!txDetails) {
            return res.status(404).json({ error: "Transaction not found" });
        }

        // Parse transaction data
        const from = txDetails.from || "Unknown";
        const to = txDetails.to || "Contract Creation";
        const value = hexToEth(txDetails.value);
        const gasPrice = txDetails.gasPrice ? (Number(BigInt(txDetails.gasPrice)) / 1e9).toFixed(2) + " Gwei" : "Unknown";
        const gasUsed = txReceipt ? hexToDecimal(txReceipt.gasUsed) : "Unknown";
        const gasCostEth = txReceipt && txDetails.gasPrice
            ? (Number(BigInt(txReceipt.gasUsed)) * Number(BigInt(txDetails.gasPrice)) / 1e18).toFixed(6)
            : "Unknown";
        const status = txReceipt ? (txReceipt.status === "0x1" ? "SUCCESS" : "FAILED") : "PENDING";
        const blockNumber = txDetails.blockNumber ? hexToDecimal(txDetails.blockNumber) : "Pending";
        const nonce = hexToDecimal(txDetails.nonce);
        const inputData = txDetails.input || "0x";
        const hasInput = inputData && inputData !== "0x";
        const logsCount = txReceipt?.logs?.length || 0;

        // Parse some known function signatures from input data
        let functionGuess = "Simple ETH Transfer";
        if (hasInput) {
            const sig = inputData.substring(0, 10);
            const knownSigs: Record<string, string> = {
                "0xa9059cbb": "ERC-20 transfer(address,uint256)",
                "0x23b872dd": "ERC-20 transferFrom(address,address,uint256)",
                "0x095ea7b3": "ERC-20 approve(address,uint256)",
                "0x38ed1739": "Uniswap swapExactTokensForTokens",
                "0x7ff36ab5": "Uniswap swapExactETHForTokens",
                "0x18cbafe5": "Uniswap swapExactTokensForETH",
                "0x5ae401dc": "Uniswap V3 multicall",
                "0x3593564c": "Uniswap Universal Router execute",
                "0xfb3bdb41": "Uniswap swapETHForExactTokens",
                "0x414bf389": "Uniswap V3 exactInputSingle",
                "0xd0e30db0": "WETH deposit (wrap ETH)",
                "0x2e1a7d4d": "WETH withdraw (unwrap ETH)",
                "0xa22cb465": "ERC-721 setApprovalForAll",
                "0x42842e0e": "ERC-721 safeTransferFrom",
                "0x1249c58b": "mint()",
                "0x40c10f19": "mint(address,uint256)",
                "0xe8e33700": "addLiquidity",
                "0xf305d719": "addLiquidityETH",
            };
            functionGuess = knownSigs[sig] || `Unknown function (${sig})`;
        }

        // Build log summary
        const logSummary = txReceipt?.logs?.slice(0, 5).map((log: any, i: number) => {
            return `  Log ${i}: contract=${log.address.substring(0, 12)}... topics=${log.topics.length} data_len=${log.data?.length || 0}`;
        }).join("\n") || "  No logs";

        const txSummary = `
TRANSACTION HASH: ${txHash}
STATUS: ${status}
BLOCK: ${blockNumber}

FROM: ${from}
TO: ${to}
VALUE: ${value} ETH
NONCE: ${nonce}

GAS PRICE: ${gasPrice}
GAS USED: ${gasUsed}
GAS COST: ${gasCostEth} ETH

FUNCTION: ${functionGuess}
INPUT DATA: ${hasInput ? `${inputData.length} chars (contract interaction)` : "None (simple transfer)"}

EVENT LOGS: ${logsCount} events emitted
${logSummary}
        `.trim();

        console.log("[TxDecoder] Parsed tx, sending to AI...");

        const aiPrompt = `You are BlockAI Transaction Decoder, an expert at explaining Ethereum transactions in plain English. Analyze this transaction and explain exactly what happened.

${txSummary}

Generate a clear, detailed explanation with these sections using markdown:

## 📋 Transaction Summary
One-paragraph plain-English explanation of what this transaction did. Be specific — mention amounts, addresses (abbreviated), and protocols if identifiable.

## 🔄 What Happened
Step-by-step breakdown of the transaction flow. What did the sender do? What contracts were involved? What tokens moved?

## ⛽ Gas Analysis
Was the gas cost reasonable? How does it compare to typical transactions of this type?

## 🏷️ Classification
Categorize this transaction: Simple Transfer / Token Transfer / DEX Swap / NFT Mint / Contract Deployment / DeFi Interaction / Other

## ⚠️ Notes
Any interesting observations, potential risks, or unusual aspects of this transaction.

Be concise but thorough. Use the function signature and logs to infer what happened even if the input data is opaque.`;

        const cgptResponse = await fetch(CHAINGPT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${CHAINGPT_API_KEY}`,
            },
            body: JSON.stringify({
                model: "general_assistant",
                question: aiPrompt,
                chatHistory: "off",
            }),
        });

        if (!cgptResponse.ok) {
            const errText = await cgptResponse.text();
            console.error("[TxDecoder] AI failed:", errText);
            return res.status(500).json({ error: "AI analysis failed", detail: errText });
        }

        const aiReport = await cgptResponse.text();
        console.log("[TxDecoder] Report generated, length:", aiReport.length);

        prisma.user.update({ where: { id: userId }, data: { points: { increment: 15 } } }).catch(() => {});
        prisma.usageLog.create({ data: { userId, action: "TX_DECODE", cost: 0 } }).catch(() => {});

        return res.json({
            report: aiReport,
            rawData: {
                txHash,
                from,
                to,
                value: `${value} ETH`,
                status,
                gasUsed,
                gasCost: `${gasCostEth} ETH`,
                function: functionGuess,
                logsCount,
                blockNumber,
            },
        });

    } catch (error: any) {
        console.error("[TxDecoder] Error:", error.message);
        return res.status(500).json({ error: error.message || "Transaction decoding failed" });
    }
};

