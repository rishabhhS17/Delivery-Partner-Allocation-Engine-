import express from 'express';

const router = express.Router();

// TODO: Mount modular routes here

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

export default router;
