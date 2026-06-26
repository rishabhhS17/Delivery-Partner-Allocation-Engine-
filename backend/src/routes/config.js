import express from 'express';
import { getWeights, setWeights, DEFAULT_WEIGHTS } from '../config/constants.js';

const router = express.Router();

// GET /api/config/weights
router.get('/weights', (req, res) => {
  res.json(getWeights());
});

// PUT /api/config/weights  body: { etar, rating, load }
// Values are auto-normalized by setWeights() so they don't need to sum to 1.
router.put('/weights', (req, res) => {
  const { etar, rating, load } = req.body;

  if (
    typeof etar !== 'number' ||
    typeof rating !== 'number' ||
    typeof load !== 'number' ||
    etar < 0 || rating < 0 || load < 0 ||
    etar + rating + load === 0
  ) {
    return res.status(400).json({
      message: 'etar, rating, and load must be non-negative numbers with a positive sum',
    });
  }

  setWeights({ etar, rating, load });
  res.json({ weights: getWeights() });
});

// PUT /api/config/weights/reset
router.put('/weights/reset', (req, res) => {
  setWeights(DEFAULT_WEIGHTS);
  res.json({ weights: getWeights() });
});

export default router;
