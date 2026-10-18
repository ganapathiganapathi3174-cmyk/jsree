import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import paymentRoutes from './routes/payments.js';
import referralRoutes from './routes/referrals.js';
import topupRoutes from './routes/topups.js';
import planRoutes from './routes/plans.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import walletRoutes from './routes/wallet.js';
import referralTierRoutes from './routes/referralTiers.js';
import exportRoutes from './routes/export.js';
import receiptRoutes from './routes/receipts.js';
import securityRoutes from './routes/security.js';
import configRoutes from './routes/config.js';
import { buildCorsOptions } from './config/cors.js';
import { authenticateToken, requireAdmin } from './middleware/auth.js';
import { cacheStats } from './middleware/cache.js';

export function createApp({ env = process.env, logger = console } = {}) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());

  const { allowedOrigins, options: corsOptions } = buildCorsOptions({ env, logger });
  logger.log?.(`[cors] allowed origins: ${allowedOrigins.join(', ')}`);
  app.use(cors(corsOptions));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many requests, please try again later.' }
  });
  app.use('/api/', limiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many auth attempts, please try again later.' }
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/admin-login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/topups', topupRoutes);
  app.use('/api/plans', planRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/referral-tiers', referralTierRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/receipts', receiptRoutes);
  app.use('/api/security', securityRoutes);
  app.use('/api/config', configRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
  });

  // Cache introspection is an admin/ops endpoint only. Keys are of the form
  // `${userId}:${originalUrl}`, so an unauthenticated response would expose
  // active user ids and the paths they visited. No in-app client consumes it.
  // (Revert to `app.get('/api/cache-stats', (req, res) => ...)` if a public
  // consumer is ever introduced.)
  app.get('/api/cache-stats', authenticateToken, requireAdmin, (req, res) => {
    res.json(cacheStats());
  });

  app.use((err, req, res, next) => {
    logger.error?.('Unhandled error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  });

  return app;
}

export default createApp;
