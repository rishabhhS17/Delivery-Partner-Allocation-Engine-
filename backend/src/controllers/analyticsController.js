import Rider from '../models/Rider.js';
import Order from '../models/Order.js';

export async function getAnalytics(req, res) {
  try {
    const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [
      totalRiders,
      availableRiders,
      activeOrders,
      completedOrders,
      throughput,
      timingAgg,
      riderFairness,
    ] = await Promise.all([
      Rider.countDocuments(),
      Rider.countDocuments({ availabilityStatus: 'ONLINE', status: 'IDLE' }),
      Order.countDocuments({ status: { $in: ['ASSIGNED', 'PICKED_UP'] } }),
      Order.countDocuments({ status: 'DELIVERED' }),
      Order.countDocuments({ status: 'DELIVERED', deliveredAt: { $gte: sixtyMinAgo } }),
      Order.aggregate([
        {
          $match: {
            status: 'DELIVERED',
            pickedUpAt:  { $exists: true },
            deliveredAt: { $exists: true },
            assignedAt:  { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            avgPickupMs:   { $avg: { $subtract: ['$pickedUpAt',  '$assignedAt']  } },
            avgDeliveryMs: { $avg: { $subtract: ['$deliveredAt', '$pickedUpAt']  } },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            status: 'DELIVERED',
            deliveredAt: { $gte: sixtyMinAgo },
            assignedRiderId: { $ne: null },
          },
        },
        { $group: { _id: '$assignedRiderId', deliveries: { $sum: 1 } } },
        {
          $lookup: {
            from:         'riders',
            localField:   '_id',
            foreignField: '_id',
            as:           'rider',
          },
        },
        { $unwind: { path: '$rider', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id:        0,
            riderId:    '$_id',
            name:       { $ifNull: ['$rider.name', 'Unknown'] },
            deliveries: 1,
          },
        },
        { $sort: { deliveries: -1 } },
      ]),
    ]);

    const timing = timingAgg[0] ?? {};

    res.json({
      totalRiders,
      availableRiders,
      activeOrders,
      completedOrders,
      avgPickupTime_s:   timing.avgPickupMs   != null ? timing.avgPickupMs   / 1000 : null,
      avgDeliveryTime_s: timing.avgDeliveryMs != null ? timing.avgDeliveryMs / 1000 : null,
      throughput,
      riderFairness,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}
