import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import exportService from '../services/exportService.js';

const router = Router();

router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await exportService.exportUsers();
    const csv = exportService.toCSV(data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/payments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await exportService.exportPayments();
    const csv = exportService.toCSV(data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=payments_export.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/topups', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await exportService.exportTopups();
    const csv = exportService.toCSV(data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=topups_export.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/financial-summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await exportService.getFinancialSummary({ startDate, endDate });
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
