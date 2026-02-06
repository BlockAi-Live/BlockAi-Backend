
import express from 'express';
import { processMintReferral, getReferralStats } from '../controllers/referralController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// Protected routes (require auth)
router.post('/track', authenticateToken, processMintReferral);
router.get('/stats', authenticateToken, getReferralStats);

export default router;
