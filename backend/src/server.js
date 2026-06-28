import { createServer } from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import connectDB from './config/db.js';
import { config } from './config/env.js';
import { initSimulation, startSimulation } from './services/simulationEngine.js';

await connectDB();

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

initSimulation(io);

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
