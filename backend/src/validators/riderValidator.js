const PHONE_RE = /^[\d+\-\s()]{7,20}$/;

export function validateRiderCreate({ name, phone, latitude, longitude, rating }) {
  if (!name || typeof name !== 'string' || name.trim().length < 2)
    return 'name must be at least 2 characters';
  if (phone !== undefined && phone !== '' && !PHONE_RE.test(phone))
    return 'phone must be a valid phone number';
  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90)
    return 'latitude must be a number between -90 and 90';
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180)
    return 'longitude must be a number between -180 and 180';
  if (rating !== undefined && (typeof rating !== 'number' || rating < 1 || rating > 5))
    return 'rating must be a number between 1 and 5';
  return null;
}

export function validateLocationUpdate({ latitude, longitude }) {
  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90)
    return 'latitude must be a number between -90 and 90';
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180)
    return 'longitude must be a number between -180 and 180';
  return null;
}

export function validateStatusUpdate({ availabilityStatus }) {
  if (!['ONLINE', 'OFFLINE'].includes(availabilityStatus))
    return 'availabilityStatus must be ONLINE or OFFLINE';
  return null;
}
