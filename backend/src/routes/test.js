import express from 'express';
import { getClassList } from '../services/quickbooks.js';

const router = express.Router();

router.get('/classes', async (req, res) => {
  try {
    const result = await getClassList();
    res.json({ result, count: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
