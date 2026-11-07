import { createServer } from 'http'; // Node's raw HTTP server
import app from './app.js'; // the Express app: REST routes + the /api/stream live feed
import connectDB from './config/db.js';
import { config } from './config/env.js';
import { startEngine, stopEngine, startLeaderElection, resignLeadership } from './engine/index.js';
import { startBots, stopBots } from './sim/index.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

// Anything unexpected that escapes is logged, then the process exits so Render restarts it and
// the engine rebuilds itself from the database (decision E1). Carrying on with half-applied
// in-memory state would be worse than a restart.
const exitOnUnexpectedError = (kind) => (err) => {
  log.error('exiting so the platform restarts the service', { kind, error: err });
  process.exit(1);
};
process.on('uncaughtException', exitOnUnexpectedError('uncaught exception'));
process.on('unhandledRejection', exitOnUnexpectedError('unhandled promise rejection'));

await connectDB();

const httpServer = createServer(app);

const PORT = config.port;

// Stop the bots and the engine (which saves every rider's final position once), then free the
// port so a nodemon restart never hits EADDRINUSE. Render sends SIGTERM before a deploy swap.
let isShuttingDown = false;
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  stopBots();
  try {
    await stopEngine();
    await resignLeadership(); // the waiting instance takes over on its next check
  } catch (err) {
    log.error('clean shutdown failed', { error: err.message });
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref(); // open sockets must not block the exit
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error('port already in use, is another instance running?', { port: PORT });
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  log.info('server listening', { port: PORT });
  // Only the instance holding the leader lease dispatches; any other one just serves the API.
  startLeaderElection({
    onElected: async () => { await startEngine(); startBots(); },
    onDeposed: async () => { stopBots(); await stopEngine(); },
  });
});
