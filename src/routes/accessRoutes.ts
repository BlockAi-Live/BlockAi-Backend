import express from 'express';
import { joinWaitlist, redeemCode, getWaitlist, generateInvite, approveWaitlist } from '../controllers/accessController';

const router = express.Router();

// Public Access
router.post('/waitlist', joinWaitlist);
router.post('/redeem', redeemCode);

// Admin Access (Protected in prod)
router.get('/admin/waitlist', getWaitlist);
router.post('/admin/invite', generateInvite);
router.post('/admin/approve', approveWaitlist);

export default router;
