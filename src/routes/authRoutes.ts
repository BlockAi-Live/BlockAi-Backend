import { Router } from 'express';
import { register, login, me, updateProfile, updatePassword, walletLogin, walletRegister } from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/wallet-login', walletLogin);
router.post('/wallet-register', walletRegister);
router.get('/me', authenticateToken, me);
router.put('/profile', authenticateToken, updateProfile);
router.put('/password', authenticateToken, updatePassword);

export default router;
