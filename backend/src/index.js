import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import foreflightRoutes from './routes/foreflight.js';
import levelflightRoutes from './routes/levelflight.js';
import assistantRoutes from './routes/assistant.js';
import rateCardRoutes from './routes/rateCards.js';
import quotesRoutes from './routes/quotes.js';
import financesRoutes from './routes/finances.js';
import testRoutes from './routes/test.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'https://exjet-dashboard.vercel.app', 'https://exjet-dashboard-production.up.railway.app'] }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'Exjet backend running' }));
app.use('/api/foreflight', foreflightRoutes);
app.use('/api/levelflight', levelflightRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/rate-cards', rateCardRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/finances', financesRoutes);
app.use('/api/test', testRoutes);

app.listen(PORT, () => console.log(`Exjet backend listening on port ${PORT}`));
