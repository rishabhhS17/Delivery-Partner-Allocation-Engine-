import { createServer } from 'http'; // Node's raw HTTP server
import { Server } from 'socket.io'; // real-time WebSocket layer
import jwt from 'jsonwebtoken'; // to verify auth tokens
import app from './app.js'; // your Express app (all the REST routes)
import connectDB from './config/db.js';
import { config } from './config/env.js';
import { initEngine, startEngine, stopEngine } from './engine/index.js';
import { startBots, stopBots } from './sim/index.js';

await connectDB();

const httpServer = createServer(app);

const allowedOrigins = [config.frontendUrl, 'http://localhost:3000', 'http://localhost:5173'];

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

initEngine(io);

// Authenticate every socket connection via JWT in the handshake before it connects.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('[ws] client connected:', socket.id);
  socket.on('disconnect', () => console.log('[ws] client disconnected:', socket.id));
});

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
  } catch (err) {
    console.error('[server] saving final positions failed:', err.message);
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref(); // open sockets must not block the exit
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} is already in use — is another instance running?`);
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startEngine()
    .then(startBots)
    .catch(console.error);
});
