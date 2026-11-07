// ─── Simulation: the bots ────────────────────────────────────────────────────
// The bots stand in for the people around the engine. They may only use the engine's public
// commands (src/engine/index.js); tests/engineSimWall.test.js enforces that.

import { startRiderBots, stopRiderBots, getRiderBotTickMs } from './riderBots.js';

export { getRiderBotTickMs };
import { startCustomerBot, stopCustomerBot } from './customerBot.js';

export function startBots() {
  startRiderBots();
  startCustomerBot();
}

export function stopBots() {
  stopRiderBots();
  stopCustomerBot();
}
