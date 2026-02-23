import express from 'express';
// @ts-ignore
import { authenticateToken } from '../middleware/authMiddleware';
// @ts-ignore
import { chat } from '../controllers/aiController';
import { 
    getprotectedResource, 
    createApiKey, 
    simulatePayment, 
    getBillingStats,
    getActivity
} from '../controllers/resourceController';
import { getNews } from '../controllers/newsController';
import { smartContract } from '../controllers/smartContractController';
import { generateNFT, getSignals } from '../controllers/nftController';
import { analyzeWallet, decodeTx } from '../controllers/walletIntelController';

const router = express.Router();

// AI Chat - Protected by JWT + Billing Guard
router.post('/chat', authenticateToken, chat);

// Smart Contract Audit / Generate - Protected by JWT
router.post('/smart-contract', authenticateToken, smartContract);

// 402 Resource Demo - Protected by API Key (or Wallet)
// We add a middleware to parse body/headers but logic is in controller
router.post('/resource', getprotectedResource); // POST to accept wallet in body

// API Key Management - Protected by JWT
router.post('/api-keys', authenticateToken, createApiKey);

// Billing Dashboard - Protected by JWT
router.get('/billing', authenticateToken, getBillingStats);

// Payment Simulation - Protected by JWT
router.post('/payment/simulate', authenticateToken, simulatePayment);

// Recent Activity - Protected by JWT
router.get('/activity', authenticateToken, getActivity);

// NFT Generator - Protected by JWT
router.post('/nft/generate', authenticateToken, generateNFT);

// AI Trading Signals - Protected by JWT
router.get('/signals', authenticateToken, getSignals);

// Wallet Intelligence Scanner - Protected by JWT
router.post('/wallet-intel', authenticateToken, analyzeWallet);

// Transaction Decoder - Protected by JWT
router.post('/decode-tx', authenticateToken, decodeTx);

// ChainGPT News Feed - Public
router.get('/news', getNews);

export default router;
