import express from 'express';
import { getLiveSnapshot, subscribeToLiveFeed } from '../engine/index.js';

const router = express.Router();

// A browser that cannot keep up gets disconnected (and reconnects to a fresh snapshot) instead
// of the server buffering its backlog without limit.
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

// GET /api/stream — Server-Sent Events. The first event is a full snapshot; after that the
// fleet arrives every second plus each order event as it happens. A reconnect starts again from
// a fresh snapshot; missed events are not replayed (decision K6).
router.get('/', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no', // tell proxies not to hold events back
  });
  res.flushHeaders();

  let unsubscribe = () => {};
  const send = (event, json) => {
    if (res.writableLength > MAX_BUFFERED_BYTES) {
      unsubscribe();
      res.end();
      return;
    }
    res.write(`event: ${event}\ndata: ${json}\n\n`);
  };

  send('snapshot', JSON.stringify(getLiveSnapshot()));
  unsubscribe = subscribeToLiveFeed(send);
  req.on('close', () => unsubscribe());
});

export default router;
