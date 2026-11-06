import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionAlongLeg } from '../utils/polyline.js';
import { haversine } from '../utils/haversine.js';

const straightLeg = { originLat: 23.35, originLng: 85.30, targetLat: 23.36, targetLng: 85.30, coords: [] };
const straightMetres = haversine({ lat: 23.35, lng: 85.30 }, { lat: 23.36, lng: 85.30 }) * 1000;

test('with no road route the rider moves in a straight line', () => {
  const halfway = positionAlongLeg(straightLeg, straightMetres / 2);
  assert.ok(Math.abs(halfway.lat - 23.355) < 1e-6);
  assert.equal(halfway.lng, 85.30);
  assert.equal(halfway.isComplete, false);
});

test('travelling at least the whole leg puts the rider at the end, complete', () => {
  const end = positionAlongLeg(straightLeg, straightMetres + 50);
  assert.deepEqual([end.lat, end.lng, end.isComplete], [23.36, 85.30, true]);
});

test('a zero-length leg is complete at once', () => {
  const leg = { originLat: 23.35, originLng: 85.30, targetLat: 23.35, targetLng: 85.30, coords: [] };
  assert.equal(positionAlongLeg(leg, 0).isComplete, true);
});

test('with a road route the rider follows it and reports the segment', () => {
  // An L-shaped route: north, then east.
  const coords = [[85.30, 23.35], [85.30, 23.36], [85.31, 23.36]];
  const leg = { ...straightLeg, coords };
  const firstLegMetres = haversine({ lat: 23.35, lng: 85.30 }, { lat: 23.36, lng: 85.30 }) * 1000;

  const onFirstSegment = positionAlongLeg(leg, firstLegMetres / 2);
  assert.equal(onFirstSegment.segmentIdx, 0);
  assert.equal(onFirstSegment.lng, 85.30);

  const onSecondSegment = positionAlongLeg(leg, firstLegMetres + 10);
  assert.equal(onSecondSegment.segmentIdx, 1);
  assert.equal(onSecondSegment.lat, 23.36);
  assert.ok(onSecondSegment.lng > 85.30);
});

test('the same leg and distance always give the same position (rebuildable after restart)', () => {
  const coords = [[85.30, 23.35], [85.30, 23.36], [85.31, 23.36]];
  const leg = { ...straightLeg, coords };
  assert.deepEqual(positionAlongLeg(leg, 1234), positionAlongLeg({ ...leg, coords: coords.map(c => [...c]) }, 1234));
});
