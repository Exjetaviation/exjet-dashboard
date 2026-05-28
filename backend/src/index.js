import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import foreflightRoutes from './routes/foreflight.js';
import levelflightRoutes from './routes/levelflight.js';
import assistantRoutes from './routes/assistant.js';
import rateCardRoutes from './routes/rateCards.js';
import quotesRoutes from './routes/quotes.js';
import financesRoutes from './routes/finances.js';
import maintenanceRoutes from './routes/maintenance.js';
import agentRoutes from './routes/agent.js';
import adsbRoutes from './routes/adsb.js';
import { requireAuth } from './middleware/requireAuth.js';

// Load QB refresh token from Supabase on startup
(async () => {
  try {
    const { supabase } = await import('./services/supabase.js');
    const { data } = await supabase.from('app_config').select('value').eq('key', 'QB_REFRESH_TOKEN').single();
    if (data?.value) process.env.QB_REFRESH_TOKEN = data.value;
  } catch (e) {}
})();
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'https://exjet-dashboard.vercel.app'] }));
app.use(express.json());

// Health check stays public so Railway can monitor the service.
app.get('/health', (req, res) => res.json({ status: 'Exjet backend running' }));

// OAuth callbacks are hit by Google / Intuit, not the browser, so they
// cannot send a login token. They stay outside the auth guard.
app.use('/api/finances/callback', financesRoutes);
app.use('/api/quotes/auth-callback', quotesRoutes);

// Everything below this line REQUIRES a valid login token.
app.use('/api', requireAuth);

app.use('/api/foreflight', foreflightRoutes);
app.use('/api/levelflight', levelflightRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/rate-cards', rateCardRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/finances', financesRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/adsb', adsbRoutes);
// Note: /api/test and /api/debug routers intentionally removed (finding F-03).

app.listen(PORT, () => console.log(`Exjet backend listening on port ${PORT}`));