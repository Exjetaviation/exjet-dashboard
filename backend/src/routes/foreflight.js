import express from 'express';
import * as ff from '../services/foreflight.js';

const router = express.Router();

router.get('/aircraft', async (req, res) => {
  try { res.json(await ff.getAircraft()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/crew', async (req, res) => {
  try { res.json(await ff.getCrew()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/flights', async (req, res) => {
  try { res.json(await ff.getFlights()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/flights/:flightId', async (req, res) => {
  try { res.json(await ff.getFlight(req.params.flightId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/flights/:flightId/briefing', async (req, res) => {
  try { res.json(await ff.getFlightBriefing(req.params.flightId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/flights/:flightId/navlog', async (req, res) => {
  try { res.json(await ff.getFlightNavlog(req.params.flightId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/flights/:flightId/wb', async (req, res) => {
  try { res.json(await ff.getFlightWb(req.params.flightId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/flights/:flightId/overflight', async (req, res) => {
  try { res.json(await ff.getFlightOverflight(req.params.flightId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/flights/:flightId/icao', async (req, res) => {
  try { res.json(await ff.getFlightIcao(req.params.flightId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
