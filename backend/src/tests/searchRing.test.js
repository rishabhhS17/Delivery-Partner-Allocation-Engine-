import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latLngToCell } from 'h3-js';
import { searchRingSize, getCandidateCells } from '../services/allocationEngine.js';
import { haversine } from '../utils/haversine.js';

test('the default 5 km range at resolution 7 needs a ring of 4', () => {
  assert.equal(searchRingSize(5, 7), 4);
});

test('the ring grows with the range (used when the search widens)', () => {
  assert.ok(searchRingSize(10, 7) > searchRingSize(5, 7));
});

test('every point within range of the restaurant falls inside the searched cells', () => {
  const restaurant = { lat: 23.35, lng: 85.33 };
  const rangeKm = 5;
  const searched = new Set(getCandidateCells(restaurant.lat, restaurant.lng, rangeKm));
  // Points on a circle just inside the range, all round the compass.
  for (let degrees = 0; degrees < 360; degrees += 5) {
    const radians = (degrees * Math.PI) / 180;
    const point = {
      lat: restaurant.lat + (rangeKm * 0.999 / 111.32) * Math.cos(radians),
      lng: restaurant.lng + (rangeKm * 0.999 / (111.32 * Math.cos((restaurant.lat * Math.PI) / 180))) * Math.sin(radians),
    };
    assert.ok(haversine(restaurant, point) <= rangeKm);
    assert.ok(searched.has(latLngToCell(point.lat, point.lng, 7)), `missed a rider at bearing ${degrees}°`);
  }
});
