import express from 'express';
// @ts-ignore
import { authenticateToken } from '../middleware/authMiddleware';
// @ts-ignore
import { chat } from '../controllers/aiController';
import { 
    getprotectedResource, 
    createApiKey, 
    simulatePayment, 
    getBillingStats 
} from '../controllers/resourceController';

const router = express.Router();

// AI Chat - Protected by JWT + Billing Guard
router.post('/chat', authenticateToken, chat);

// 402 Resource Demo - Protected by API Key (or Wallet)
// We add a middleware to parse body/headers but logic is in controller
router.post('/resource', getprotectedResource); // POST to accept wallet in body

// API Key Management - Protected by JWT
router.post('/api-keys', authenticateToken, createApiKey);

// Billing Dashboard - Protected by JWT
router.get('/billing', authenticateToken, getBillingStats);

// Payment Simulation - Protected by JWT
router.post('/payment/simulate', authenticateToken, simulatePayment);

export default router;
