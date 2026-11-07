// ─── Simulation: the bots ────────────────────────────────────────────────────
// The bots stand in for the people around the engine. They may only use the engine's public
// commands (src/engine/index.js); tests/engineSimWall.test.js enforces that.

import {
  startRiderBots, stopRiderBots, getRiderBotTickMs, forceNextRiderAction, getForcedRiderActions,
} from './riderBots.js';

export { getRiderBotTickMs, forceNextRiderAction, getForcedRiderActions };
import { startCustomerBot, stopCustomerBot } from './customerBot.js';
import {
  startKitchenBot, stopKitchenBot, forceNextKitchenAction, getForcedKitchenActions,
} from './kitchenBot.js';

export { forceNextKitchenAction, getForcedKitchenActions };

export function startBots() {
  startRiderBots();
  startCustomerBot();
  startKitchenBot();
}

export function stopBots() {
  stopRiderBots();
  stopCustomerBot();
  stopKitchenBot();
}
