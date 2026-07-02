import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import app from './app.js';
import connectDB from './config/db.js';
import { config } from './config/env.js';
import { initSimulation, startSimulation } from './services/simulationEngine.js';

await connectDB();

const httpServer = createServer(app);

const allowedOrigins = [config.frontendUrl, 'http://localhost:3000', 'http://localhost:5173'];

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

initSimulation(io);

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

// Free the port cleanly on nodemon restart so EADDRINUSE never occurs
const shutdown = () => httpServer.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} is already in use — is another instance running?`);
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startSimulation().catch(console.error);
});
