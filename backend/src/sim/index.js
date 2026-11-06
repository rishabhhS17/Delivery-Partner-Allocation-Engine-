// ─── Simulation: the bots ────────────────────────────────────────────────────
// The bots stand in for the people around the engine. They may only use the engine's public
// commands (src/engine/index.js); tests/engineSimWall.test.js enforces that.

import { startRiderBots } from './riderBots.js';
import { startCustomerBot } from './customerBot.js';

export function startBots() {
  startRiderBots();
  startCustomerBot();
}
