import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import foreflightRoutes from './routes/foreflight.js';
import levelflightRoutes from './routes/levelflight.js';
import assistantRoutes from './routes/assistant.js';
import rateCardRoutes from './routes/rateCards.js';
import quotesRoutes, { gmailOauthCallback } from './routes/quotes.js';
import financesRoutes, { financeOauthCallback } from './routes/finances.js';
import maintenanceRoutes from './routes/maintenance.js';
import agentRoutes from './routes/agent.js';
import adsbRoutes from './routes/adsb.js';
import tripSheetRoutes from './routes/tripSheet.js';
import publicQuotesRoutes from './routes/publicQuotes.js';
import publicItineraryRoutes from './routes/publicItinerary.js';
import { requireAuth } from './middleware/requireAuth.js';
import { startRecorder } from './services/adsbRecorder.js';
import { startReconciler } from './services/flightTrackReconciler.js';
import schedulingRoutes from './routes/scheduling.js';
import fuelRoutes from './routes/fuel.js';
import fleetRouter from './routes/fleet.js';
import { startSyncWorker } from './scheduling/syncWorker.js';
import { startFuelMailWorker } from './services/fuel/fuelMailWorker.js';
import { startSlackWatcher } from './slack/slackWatcher.js';

// Load QB refresh token from Supabase on startup
(async () => {
  try {
    const { supabase } = await import('./services/supabase.js');
    const { data } = await supabase.from('app_config').select('value').eq('key', 'QB_REFRESH_TOKEN').single();
    if (data?.value) process.env.QB_REFRESH_TOKEN = data.value;
  } catch {}
})();
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'https://exjet-dashboard.vercel.app'] }));
app.use(express.json());

// Health check stays public so Railway can monitor the service.
app.get('/health', (req, res) => res.json({ status: 'Exjet backend running' }));

// OAuth redirect callbacks are hit by Intuit / Google, not the browser, so they
// cannot send a login token. ONLY these two exact paths are public — using
// app.get (exact match) instead of app.use (prefix mount) so sibling finance /
// quote routes are NOT exposed (audit findings C1, C2).
app.get('/api/finances/callback', financeOauthCallback);
app.get('/api/quotes/auth-callback', gmailOauthCallback);

// Public quote pages — unauthenticated access via 24-char dispatch ID.
app.use('/quote', publicQuotesRoutes);
// Public passenger-itinerary pages — same unauthenticated dispatch-ID access model.
app.use('/itinerary', publicItineraryRoutes);

// Everything below this line REQUIRES a valid login token. No exemptions.
app.use('/api', requireAuth);

app.use('/api/foreflight', foreflightRoutes);
app.use('/api/levelflight', levelflightRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/rate-cards', rateCardRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/tripsheet', tripSheetRoutes);
app.use('/api/finances', financesRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/adsb', adsbRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/fuel', fuelRoutes);
app.use('/api/fleet', fleetRouter);
// Note: /api/test and /api/debug routers intentionally removed (finding F-03).

app.listen(PORT, () => {
  console.log(`Exjet backend listening on port ${PORT}`);
  startRecorder();
  startReconciler();
  startSyncWorker();
  startFuelMailWorker();
  startSlackWatcher();
});