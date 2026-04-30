import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import aiRoutes from './routes/aiRoutes';
import accessRoutes from './routes/accessRoutes';
import referralRoutes from './routes/referralRoutes';
import campaignRoutes from './routes/campaignRoutes';

import rateLimit from 'express-rate-limit';


const app = express();
const PORT = process.env.PORT || 3000;

// Rate Limiter
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
	standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// CORS must be first so rate-limited (429) responses still include CORS headers
app.use(cors());
app.use(express.json());

// Apply the rate limiting middleware to all requests.
app.use(limiter);

app.use('/api/auth', authRoutes);
app.use('/api/v1', aiRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/campaign', campaignRoutes);

app.get('/', (req, res) => {
  res.send('BlockAI Backend is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
