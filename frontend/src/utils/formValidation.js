// Shared client-side validation for the Rider/Restaurant/Customer create dialogs. Mirrors the
// backend's validators (backend/src/validators/*.js) so the UI can reject bad input before it
// ever reaches the API — in particular, an empty-string latitude/longitude field must never
// silently become 0 via Number(''), which is a valid coordinate today with no guard.

export function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 2;
}

export function isValidPhone(phone) {
  // Phone is optional everywhere it's used — an empty/omitted value is valid.
  if (phone === undefined || phone === null || phone === '') return true;
  return /^[\d+\-\s()]{7,20}$/.test(phone);
}

export function isValidLatitude(value) {
  if (value === '' || value === undefined || value === null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

export function isValidLongitude(value) {
  if (value === '' || value === undefined || value === null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

export function isValidRating(rating) {
  // Rating is optional (server defaults to 4 when omitted).
  if (rating === undefined || rating === null || rating === '') return true;
  const n = Number(rating);
  return Number.isFinite(n) && n >= 1 && n <= 5;
}

// Returns a { field: message } map of every currently-invalid field in `form`. An empty object
// means the form is valid. Name and coordinates are required everywhere this is used; phone and
// rating are optional everywhere this is used, matching the backend validators exactly.
export function validateLocationForm(form) {
  const errors = {};

  if (!isValidName(form.name)) errors.name = 'Name must be at least 2 characters';
  if (!isValidPhone(form.phone)) errors.phone = 'Enter a valid phone number';
  if (!isValidLatitude(form.latitude)) errors.latitude = 'Latitude must be between -90 and 90';
  if (!isValidLongitude(form.longitude)) errors.longitude = 'Longitude must be between -180 and 180';
  if ('rating' in form && !isValidRating(form.rating)) errors.rating = 'Rating must be between 1 and 5';

  return errors;
}
