import express from 'express';
// @ts-ignore
import { authenticateToken } from '../middleware/authMiddleware';
import {
  getCampaignProgress,
  completeTask,
  setTwitterHandle,
  generateAccessCode,
  redeemAccessCode,
  submitFeedback,
  editFeedback,
  reviewFeedback,
  createInvestorCode,
  getAllFeedback,
} from '../controllers/campaignController';

const router = express.Router();

// ─── User Endpoints (JWT Protected) ─────────────────────
router.get('/progress', authenticateToken, getCampaignProgress);
router.post('/set-twitter', authenticateToken, setTwitterHandle);
router.post('/complete-task', authenticateToken, completeTask);
router.post('/generate-code', authenticateToken, generateAccessCode);
router.post('/redeem-code', authenticateToken, redeemAccessCode);
router.post('/submit-feedback', authenticateToken, submitFeedback);
router.put('/edit-feedback', authenticateToken, editFeedback);

// ─── Admin Endpoints (add admin middleware in production) ─
router.post('/admin/review', reviewFeedback);
router.post('/admin/investor-code', createInvestorCode);
router.get('/admin/feedback', getAllFeedback);

export default router;
