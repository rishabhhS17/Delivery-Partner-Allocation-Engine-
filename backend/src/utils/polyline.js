import { RIDER_SPEED_KMH, TICK_INTERVAL_MS } from '../config/constants.js';
import { haversine } from './haversine.js';

// ─── Polyline traversal (unchanged) ─────────────────────────────────────────────

export function _advanceAlongPolyline(rider) {
  const metersPerTick = (RIDER_SPEED_KMH / 3.6) * (TICK_INTERVAL_MS / 1000);
  _preAdvancePolyline(rider, metersPerTick);

  const coords = rider.legCoords;
  const segIdx = rider.currentSegmentIdx;

  if (segIdx >= coords.length - 1) {
    const last = coords[coords.length - 1];
    rider.lat  = last[1];
    rider.lng  = last[0];
    return true;
  }

  const from   = coords[segIdx];
  const to     = coords[segIdx + 1];
  const segLen = haversine({ lat: from[1], lng: from[0] }, { lat: to[1], lng: to[0] }) * 1000;
  const t      = segLen > 0 ? Math.min(1, rider.distanceCoveredOnSegment / segLen) : 0;
  rider.lat    = from[1] + t * (to[1] - from[1]);
  rider.lng    = from[0] + t * (to[0] - from[0]);
  return false;
}

export function _preAdvancePolyline(rider, meters) {
  let remaining = meters;
  const coords  = rider.legCoords;
  let segIdx    = rider.currentSegmentIdx;
  let distOnSeg = rider.distanceCoveredOnSegment;

  while (remaining > 0 && segIdx < coords.length - 1) {
    const from   = coords[segIdx];
    const to     = coords[segIdx + 1];
    const segLen = haversine({ lat: from[1], lng: from[0] }, { lat: to[1], lng: to[0] }) * 1000;
    const left   = segLen - distOnSeg;

    if (remaining >= left) {
      remaining -= left;
      segIdx++;
      distOnSeg = 0;
    } else {
      distOnSeg += remaining;
      remaining  = 0;
    }
  }

  rider.currentSegmentIdx        = segIdx;
  rider.distanceCoveredOnSegment = distOnSeg;
}

export function _positionFromPolyline(rider) {
  const coords = rider.legCoords;
  const segIdx = rider.currentSegmentIdx;

  if (segIdx >= coords.length - 1) {
    const last = coords[coords.length - 1];
    rider.lat  = last[1];
    rider.lng  = last[0];
    return;
  }

  const from   = coords[segIdx];
  const to     = coords[segIdx + 1];
  const segLen = haversine({ lat: from[1], lng: from[0] }, { lat: to[1], lng: to[0] }) * 1000;
  const t      = segLen > 0 ? Math.min(1, rider.distanceCoveredOnSegment / segLen) : 0;
  rider.lat    = from[1] + t * (to[1] - from[1]);
  rider.lng    = from[0] + t * (to[0] - from[0]);
}
