import express from 'express';
import * as ff from '../services/foreflight.js';

const router = express.Router();

router.get('/aircraft', async (req, res) => {
  try {
    const data = await ff.getAircraft();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/crew', async (req, res) => {
  try {
    const data = await ff.getCrew();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/flights', async (req, res) => {
  try {
    const data = await ff.getFlights();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/flights/:flightId', async (req, res) => {
  try {
    const data = await ff.getFlight(req.params.flightId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
