import express from 'express';
import { qbFetch } from '../services/quickbooks.js';

const router = express.Router();

router.get('/classes', async (req, res) => {
  try {
    const data = await qbFetch('query', {
      query: `SELECT * FROM Class MAXRESULTS 20`,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
