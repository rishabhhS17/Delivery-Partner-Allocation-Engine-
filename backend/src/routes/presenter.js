import express from 'express';
import { config } from '../config/env.js';
import { simulateDatabaseOutage, getDatabaseOutageEnd, crashAndRecover } from '../engine/index.js';
import {
  forceNextRiderAction, getForcedRiderActions, forceNextKitchenAction, getForcedKitchenActions,
} from '../sim/index.js';

// Presenter panel actions (decision I3): make the next edge case happen on demand.
const router = express.Router();

const RIDER_ACTIONS   = ['reject', 'ignore', 'cancel'];
const KITCHEN_ACTIONS = ['reject', 'delay', 'early'];
const OUTAGE_DURATION_MS = 60_000;

// GET /api/presenter → what is queued and whether the outage hook is available
router.get('/', (req, res) => {
  res.json({
    pendingRiderActions:   getForcedRiderActions(),
    pendingKitchenActions: getForcedKitchenActions(),
    isOutageHookEnabled:   config.isSimulationTestHooksEnabled,
    databaseOutageEndsAt:  getDatabaseOutageEnd(),
  });
});

// POST /api/presenter/riders/:action — next offer rejected / ignored, or a pickup cancelled now
router.post('/riders/:action', (req, res) => {
  if (!RIDER_ACTIONS.includes(req.params.action)) {
    return res.status(400).json({ message: `action must be one of ${RIDER_ACTIONS.join(', ')}` });
  }
  forceNextRiderAction(req.params.action);
  res.json({ queued: req.params.action, pendingRiderActions: getForcedRiderActions() });
});

// POST /api/presenter/kitchens/:action — the newest open order is rejected / delayed / early
router.post('/kitchens/:action', (req, res) => {
  if (!KITCHEN_ACTIONS.includes(req.params.action)) {
    return res.status(400).json({ message: `action must be one of ${KITCHEN_ACTIONS.join(', ')}` });
  }
  forceNextKitchenAction(req.params.action);
  res.json({ queued: req.params.action, pendingKitchenActions: getForcedKitchenActions() });
});

// POST /api/presenter/database-outage — 60 s simulated outage; a test hook, so only when
// SIMULATION_ENABLED=true.
router.post('/database-outage', (req, res) => {
  if (!config.isSimulationTestHooksEnabled) {
    return res.status(403).json({ message: 'The outage test hook is off (set SIMULATION_ENABLED=true to enable it)' });
  }
  res.json({ databaseOutageEndsAt: simulateDatabaseOutage(OUTAGE_DURATION_MS) });
});

// POST /api/presenter/crash-engine — wipe the engine's memory and recover from the database
// using the real restart path, without exiting (decision I1).
router.post('/crash-engine', async (req, res, next) => {
  try {
    res.json(await crashAndRecover());
  } catch (err) {
    next(err);
  }
});

export default router;
