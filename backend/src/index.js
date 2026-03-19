import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import foreflightRoutes from './routes/foreflight.js';
import levelflightRoutes from './routes/levelflight.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'Exjet backend running' });
});

app.use('/api/foreflight', foreflightRoutes);
app.use('/api/levelflight', levelflightRoutes);

app.listen(PORT, () => {
  console.log(`Exjet backend listening on port ${PORT}`);
});
