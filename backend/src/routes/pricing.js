import express from 'express';
import { extractAndStorePricingHistory, buildRegressionModel, estimatePrice } from '../services/pricingModel.js';

const router = express.Router();

router.post('/sync', async (req, res) => {
  try {
    const result = await extractAndStorePricingHistory();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/model', async (req, res) => {
  try {
    const result = await buildRegressionModel();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/estimate', async (req, res) => {
  try {
    const result = await estimatePrice(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
