import express from 'express';
import {
  createRider,
  getAllRiders,
  getRiderById,
  updateLocation,
  updateStatus,
} from '../controllers/riderController.js';

const router = express.Router();

router.post('/',              createRider);
router.get('/',               getAllRiders);
router.get('/:id',            getRiderById);
router.put('/:id/location',   updateLocation);
router.put('/:id/status',     updateStatus);

export default router;
