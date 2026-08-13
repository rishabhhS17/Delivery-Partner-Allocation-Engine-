import express from 'express';
import {
  getWeights, setWeights, DEFAULT_WEIGHTS,
  getOrderTtl, setOrderTtl,
  getH3Config, setH3Config,
} from '../config/constants.js';
import { clearCandidateCache } from '../services/allocationEngine.js';

const router = express.Router();

// GET /api/config/weights
router.get('/weights', (req, res) => {
  res.json(getWeights());
});

// PUT /api/config/weights  body: { etar, load }
// Values are auto-normalized by setWeights() so they don't need to sum to 1.
router.put('/weights', (req, res) => {
  const { etar, load } = req.body;

  if (
    typeof etar !== 'number' ||
    typeof load !== 'number' ||
    etar < 0 || load < 0 ||
    etar + load === 0
  ) {
    return res.status(400).json({
      message: 'etar and load must be non-negative numbers with a positive sum',
    });
  }

  setWeights({ etar, load });
  res.json({ weights: getWeights() });
});

// PUT /api/config/weights/reset
router.put('/weights/reset', (req, res) => {
  setWeights(DEFAULT_WEIGHTS);
  res.json({ weights: getWeights() });
});

// ── Order TTL (applies live) ──────────────────────────────────────────────────
// GET /api/config/ttl → { orderTtlMs }
router.get('/ttl', (req, res) => {
  res.json({ orderTtlMs: getOrderTtl() });
});

// PUT /api/config/ttl  body: { orderTtlMs }  — read at query time, so it applies immediately.
router.put('/ttl', (req, res) => {
  try {
    setOrderTtl(req.body?.orderTtlMs);
    res.json({ orderTtlMs: getOrderTtl() });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── H3 grid config ────────────────────────────────────────────────────────────
// GET /api/config/h3 → { resolution, candidateK, restaurantServiceK }
router.get('/h3', (req, res) => {
  res.json(getH3Config());
});

// PUT /api/config/h3  body: { resolution?, candidateK?, restaurantServiceK? }
// candidateK (rider selection) + restaurantServiceK (restaurant selection) apply immediately;
// resolution changes only fully take effect after a simulation restart (riders re-bucket on
// hydrate). The candidate-cell cache is cleared so the next allocation uses the new values.
router.put('/h3', (req, res) => {
  try {
    setH3Config(req.body ?? {});
    clearCandidateCache();
    res.json(getH3Config());
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
