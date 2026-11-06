import express from 'express';
import { getStatus } from '../services/simulation/index.js';

const router = express.Router();

// The simulation runs whenever the server runs (decision B1), so there is no start/stop.
router.get('/status', (req, res) => {
  res.json({ success: true, status: getStatus() });
});

export default router;
