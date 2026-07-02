const PHONE_RE = /^[\d+\-\s()]{7,20}$/;

export function validateCustomerCreate({ name, phone, latitude, longitude }) {
  if (!name || typeof name !== 'string' || name.trim().length < 2)
    return 'name must be at least 2 characters';
  if (phone !== undefined && phone !== '' && !PHONE_RE.test(phone))
    return 'phone must be a valid phone number';
  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90)
    return 'latitude must be a number between -90 and 90';
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180)
    return 'longitude must be a number between -180 and 180';
  return null;
}
