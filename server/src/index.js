import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apiRouter from './routes.js';
import { connectDb } from './db.js';

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'qr-attendance-api' });
});
app.use('/api', apiRouter);

app.use((_request, response) => {
  response.status(404).json({ error: 'Route not found' });
});

if (process.env.NODE_ENV !== 'test') {
  const startServer = async () => {
    try {
      await connectDb();
      const server = app.listen(port, () => {
        console.log(`QR attendance API listening on http://localhost:${port}`);
      });

      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${port} is already in use. Stop the existing server or choose another PORT in server/.env.`);
        } else {
          console.error('Unable to start the QR attendance API:', error.message);
        }
        process.exitCode = 1;
      });
    } catch (error) {
      console.error('Unable to connect to MongoDB:', error.message);
      process.exitCode = 1;
    }
  };

  startServer();
}

export { app };
