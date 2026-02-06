import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import aiRoutes from './routes/aiRoutes';
import accessRoutes from './routes/accessRoutes';
import referralRoutes from './routes/referralRoutes';

import rateLimit from 'express-rate-limit';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Rate Limiter
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
	standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply the rate limiting middleware to all requests.
app.use(limiter);

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/v1', aiRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/referrals', referralRoutes);


app.get('/', (req, res) => {
  res.send('BlockAI Backend is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
