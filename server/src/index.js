import dotenv from 'dotenv';
import createApp from './app.js';
import { autoExpireStalePayments } from './services/paymentService.js';

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Auto-expire stale payment requests every 5 minutes.
  // This is a safety net — expiry is also enforced at upload/verify time.
  // The interval is intentionally short to keep the UX responsive.
  setInterval(async () => {
    try {
      const result = await autoExpireStalePayments();
      if (result.expired > 0) {
        console.log(`[auto-expire] Expired ${result.expired} stale payment request(s)`);
      }
    } catch (e) {
      console.error('[auto-expire] Error during auto-expiry sweep:', e.message);
    }
  }, 5 * 60 * 1000);
});

export default app;
