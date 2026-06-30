import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

export const protect = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  try {
    req.user = jwt.verify(header.slice(7), config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};
