# Changelog

## 2026-07-02 — Nine-priority feature pass

Implements: (1) false "Live feed disconnected" banner fix, (2) Mapbox route caching, (3) admin
rider creation, (4) form validation, (5) reusable map location picker, (6) current-order display
fix, (7) customer-initiated order flow, (8) rider dashboard metrics, (9) registration /
forgot-password / OTP / email auth subsystem. Full design rationale lives in the approved plan
at `C:\Users\Aman Kumar\.claude\plans\luminous-conjuring-tulip.md`.

No existing functionality was removed; all changes are additive or backward-compatible extensions
of existing endpoints/components.

---

### Priority 1 — Fixed the false "Live feed disconnected" banner

**Root cause (two compounding bugs):**
1. `backend/src/server.js`'s Socket.IO server requires a JWT in the connection handshake
   (`io.use(...)`), but `SimulationContext.jsx`'s socket-creation effect ran once on mount with
   an empty dependency array, before login could ever complete — so the socket could be created
   with no token, get rejected, and never retry once the user actually logged in.
2. `ConnectionBanner.jsx` rendered the alarming message on a bare `if (!connected)` with zero
   debounce, unlike every other consumer of the same flag (`Topbar`, `Dashboard`, `RiderMap`,
   `OrdersMap`), which already treat it as a benign "waiting" state.

**Fix:**
- `frontend/src/context/SimulationContext.jsx` — the socket effect now depends on
  `[authLoading, user?._id]` (via `useAuth()`), so it only connects once a valid, rehydrated
  token exists, and correctly tears down / reconnects on login and logout. Added
  `hasEverConnectedRef` and a 4-second (`DISCONNECT_GRACE_MS`) debounce before exposing a new
  `showDisconnectedBanner` flag, which only arms if the socket had genuinely connected before.
- `frontend/src/components/common/ConnectionBanner.jsx` — now reads `showDisconnectedBanner`
  instead of the raw `connected` flag. No other consumer of `connected` was touched.

---

### Priority 2 — Mapbox route caching

**File:** `backend/src/services/routingService.js` (only file changed — no caller changes).

Added an in-memory `Map` cache in front of the existing `MAX_CONCURRENT = 3` request queue.
Cache key rounds each of the three coordinates (rider, restaurant, customer) to ~111m
(`Math.round(n * 1000) / 1000`); entries expire after `ROUTE_CACHE_TTL_MS` (5 minutes) and are
pruned opportunistically on write. A cache hit resolves instantly without consuming a
concurrency slot. Failed Mapbox calls are never cached. A hit/miss counter logs cache
effectiveness to the console every 20 calls (`[routing] route cache: X/Y hits ...`).

---

### Priority 3 — Admin can create riders

Backend (`POST /riders` → `riderController.createRider` → `riderValidator.validateRiderCreate`)
**already existed** — this was frontend-only work:
- `frontend/src/api/endpoints.js` — added `createRider(body)`.
- `frontend/src/pages/Riders.jsx` — added an "Add rider" button and create dialog (name, phone,
  rating, and a `LocationPicker` for coordinates), mirroring the existing Restaurant/Customer
  dialog pattern exactly. New riders are created `OFFLINE`/`IDLE` server-side (unchanged,
  existing behavior) — no availability toggle is exposed since the backend ignores it.
- `frontend/src/pages/Riders.module.css` — added `.dialogForm`/`.fieldError`.

---

### Priority 4 — Validation everywhere

**Backend** (additive-only — `phone` stays optional everywhere):
- `backend/src/validators/{riderValidator,restaurantValidator,customerValidator}.js` — added a
  shared phone-format check (`/^[\d+\-\s()]{7,20}$/`), only enforced when `phone` is a non-empty
  string.

**Frontend:**
- New `frontend/src/utils/formValidation.js` — `isValidName`, `isValidPhone`,
  `isValidLatitude`/`isValidLongitude` (reject out-of-range **and** empty-string — closing the
  real bug where `Number('')` silently became a valid `(0, 0)` coordinate), `isValidRating`, and
  `validateLocationForm(form)`.
- `Restaurants.jsx`, `Customers.jsx`, `Riders.jsx` dialogs — each now computes `errors` inline,
  shows a field's error once it's been touched or submit was attempted (`attemptedSubmit`
  state), and disables Save while `Object.keys(errors).length > 0`.
- `.fieldError` class added to each page's `.module.css`, reusing the existing `var(--error)`
  token from `Login.module.css`.

---

### Priority 5 — Reusable `LocationPicker` component

**New files:** `frontend/src/components/common/LocationPicker.jsx` + `.module.css`.

`<LocationPicker latitude={} longitude={} onChange={(lat, lng) => void} />` — an inline Mapbox
map (matching the exact setup used in `RiderMap.jsx`/`OrdersMap.jsx`: `mapbox://styles/mapbox/dark-v11`,
Ranchi default center) plus its own bidirectionally-synced lat/lng text fields, all owned
internally so parent dialogs render only `<LocationPicker />` in place of two plain `TextField`s.
Clicking the map or typing coordinates both funnel through the same `onChange`. Retrofitted into
the Restaurants, Customers, and Riders create dialogs, replacing their plain lat/lng fields.
Reverse geocoding was deliberately **not** implemented (no existing geocoding infra in the repo;
scoped out as a self-contained future addition).

---

### Priority 6 — Fixed "Current order" display

Previously showed the raw Mongo `currentOrderId`. Now shows `Restaurant → Customer`, matching
the pattern already used by Dashboard's Recent Allocations.

- `backend/src/controllers/riderController.js` — `getAllRiders`/`getRiderById` now
  `.populate('currentOrderId', 'restaurantName customerName')`; `serializeRider()` attaches a
  flattened `currentOrderSummary: {restaurantName, customerName} | null` while `currentOrderId`
  itself still returns the raw id.
- `frontend/src/pages/Riders.jsx` — renders `` `${restaurantName} → ${customerName}` `` or `—`.

Fixed on the backend/REST layer specifically (not by cross-referencing the live socket feed),
since the socket's rider list only ever contains `ONLINE` riders and this page must show all
riders regardless of status.

---

### Priority 7 — Customer-initiated order flow

Extended the existing single-order endpoint rather than adding a new one or removing the Orders
page (Option B).

- `backend/src/services/orderGenerator.js` — `createOrder({customerId, restaurantId} = {})`: if
  both are given, creates an order for that specific active pair; otherwise falls through to the
  existing random `pickPair()` behavior unchanged (verified `bulkCreateOrders` and the
  auto-order timer, which both call `createOrder()` with no args, are unaffected).
- `backend/src/controllers/orderController.js` — `createSingleOrder` passes
  `{customerId, restaurantId}` from the request body through; rejects a half-specified pair with
  400. Existing idempotency-key dedup and the "simulation must be running" 409 guard apply
  unchanged.
- `frontend/src/api/endpoints.js` — `createOrder` signature changed from `(key)` to
  `(body = {}, key)`; the existing random-create call site in `Orders.jsx` was updated to match
  (`createOrder({}, crypto.randomUUID())`).
- `frontend/src/pages/Customers.jsx` — added a "Place order" icon-button per row that navigates
  to `/orders` with `{prefillCustomerId, prefillCustomerName}` in router state.
- `frontend/src/pages/Orders.jsx` — reads that router state on mount, opens a new "Place order
  for [customer]" dialog (restaurant selection only), and clears the state so a refresh/back-nav
  doesn't re-trigger it. The existing random "Create order" and "Bulk create" buttons/behavior
  are completely untouched.

A user-picked pair intentionally bypasses the H3 service-area constraint `pickPair()` normally
enforces — the allocation engine doesn't hard-require proximity, it just produces a longer ETA,
and this is a simulation/ops tool where that flexibility is more valuable than the constraint.

---

### Priority 8 — Rider dashboard metrics

Shipped the zero-cost slice; deferred the two metrics that need new tracked data.

- `backend/src/controllers/riderController.js` — `serializeRider()` now also returns
  `totalOrders` (`deliveryTimestamps.length`) and `ordersLastHour` (filtered to the last 60
  minutes) — both derived from the existing `Rider.deliveryTimestamps` array with no new query.
- `frontend/src/pages/Riders.jsx` — table columns are now Name, Rating, Availability, Movement,
  Current order, Total orders, Orders (1h) — phone dropped as requested ("not unnecessary
  address/phone").
- **Deferred** (documented in the plan, not implemented): Average delivery time (needs a
  per-rider aggregate, same shape as `analyticsController.js`'s existing `riderFairness`
  aggregate — recommend a lazy/opt-in fetch, not embedded in the base list load); Utilization
  (no "went online at" timestamp exists yet — needs a schema/definition decision); Distance
  travelled (not tracked anywhere — would require touching `simulationEngine.js`'s hot tick-loop
  path for a field with no other stated requirement).

---

### Priority 9 — Auth: registration, forgot/reset password, OTP, email, Google avatar

**Schema** — `backend/src/models/User.js`: added `avatarUrl`, `isVerified` (default `false`),
`otpHash`, `otpExpiresAt`, `otpPurpose` (`'register' | 'reset' | null`). No migration script
needed — Mongoose applies these as defaults when reading pre-existing documents. The existing
`/login` route was **deliberately not gated** on `isVerified`, to avoid breaking every
pre-existing account (including the seeded admin), which would otherwise read as unverified.

**Email** — new `backend/src/services/emailService.js` (`nodemailer`, added as a dependency):
`sendOtpEmail(toEmail, otp, purpose)`. When `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` aren't set (new,
optional env vars in `config/env.js`, not fail-fast), the OTP is logged to the server console
instead of thrown — keeps registration/reset fully testable without real mail credentials.

**New backend routes** (`backend/src/controllers/authController.js`, wired in
`backend/src/routes/auth.js` behind a shared `otpLimiter`, 5 requests/15min, matching the
existing `loginLimiter` shape):
```
POST /auth/register                    { email, password }
POST /auth/register/verify-otp         { email, otp }
POST /auth/forgot-password             { email }
POST /auth/forgot-password/verify-otp  { email, otp }
POST /auth/reset-password              { resetToken, newPassword }
```
`/forgot-password` always returns the same generic response regardless of whether the email
exists (prevents user enumeration). Re-registering an email with an abandoned, never-verified
signup overwrites that record's password/OTP in place rather than failing on the unique-email
index. OTPs are 6-digit, bcrypt-hashed at rest, 10-minute expiry. `verify-otp` for password reset
issues a short-lived (10-minute) reset token rather than allowing an immediate password change.

**Bundled adjacent fixes** (both inside `backend/src/config/passport.js`, touched anyway by this
priority):
- **Fixed a real, previously-live privilege-escalation bug**: every new Google OAuth signup was
  hardcoded to `role: 'admin'`. Now defaults to `'partner'`, matching the project's own build
  spec. New Google signups are `isVerified: true` immediately (Google itself proves email
  ownership).
- **Google avatar capture**: `profile.photos?.[0]?.value` is now saved to `User.avatarUrl` on
  every login (not just the first), so a changed Google profile photo stays in sync.
- `backend/src/routes/auth.js` — `/login`'s response now includes `avatarUrl`; `/me` already
  returns it automatically (full user document minus `passwordHash`/`otpHash`).

**New frontend pages** (mirror `Login.jsx`'s exact structure/styling):
- `frontend/src/pages/Register.jsx` — email/password step → inline OTP step → auto-login via
  `loginWithToken()`.
- `frontend/src/pages/ForgotPassword.jsx` — email → OTP → new password, three inline steps.
- `frontend/src/routes/AppRoutes.jsx` — added `/register` and `/forgot-password`, both public.
- `frontend/src/pages/Login.jsx` — added "Forgot password?" / "Create an account" links.
- `frontend/src/api/endpoints.js` — added `register`, `verifyRegisterOtp`, `forgotPassword`,
  `verifyResetOtp`, `resetPassword`.
- `frontend/src/components/navigation/Topbar.jsx` — `<Avatar src={user?.avatarUrl}>` now shows
  the Google profile picture when present; falls back to initials automatically (MUI `Avatar`'s
  built-in behavior when `src` is unset or fails to load) — no fallback logic needed.

**New environment variables** (optional): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM` — documented in `backend/.env.example`.

---

### Verification performed

- Backend: `npm test` (Node's built-in test runner) — 15/16 passing both before and after this
  work; the one failure (`simulationState.test.js`) requires a real `MONGODB_URI`/`.env` file
  that doesn't exist in this dev environment — pre-existing, unrelated to these changes.
- Backend: `node --check` on every new/modified file — all pass.
- Frontend: `npm run build` (Vite production build) — succeeds cleanly across every new/modified
  component, page, and context.
- `npm install` was run in both `backend/` and `frontend/`; `nodemailer` added to
  `backend/package.json`.
### Live end-to-end verification (2026-07-02, post-implementation)

After the initial static verification above, the app was actually run and driven — first against
a disposable local Docker MongoDB, then against the real Atlas cluster, real Mapbox account, real
Google OAuth credentials, and real Gmail SMTP. Findings from that session, and fixes applied as a
direct result:

- **`isVerified` gap on pre-existing accounts.** Every account that existed before this session's
  auth work (the seeded admin, plus several Google-linked accounts) had no `isVerified` field set,
  which defaults to `false` — meaning `forgot-password` silently refused to send them a code (by
  design, to avoid leaking which emails exist, so this failed silently rather than with an error).
  **Fixed via a one-time backfill** against the real database: any account with a working
  password hash or a linked `googleId` (i.e., already provably owns that login) was marked
  `isVerified: true`. New accounts going through registration are unaffected — they still require
  OTP verification. Ran as a one-off script, not a migration file, since it only needed to run
  once against the one real database in question.
- **Confirmed the OAuth privilege-escalation bug was real and had already caused live damage.**
  Every one of the 5 pre-existing Google-linked accounts in the real database had `role: 'admin'`
  — direct, real-world confirmation of the bug this session fixed. The fix only prevents *future*
  over-privileged signups; it does not retroactively correct these 5 existing accounts (that would
  be a data decision, not something a code fix should silently do).
- **The Mapbox token in `.env` was invalid.** Confirmed directly against Mapbox's own API
  (bypassing the app entirely) — `{"code":"TokenRevoked", ...}`. This caused both blank map tiles
  in the frontend and the backend's route-fetching to fail (with graceful fallback to straight-line
  movement, as designed — nothing crashed). Not a code issue; resolved by generating a fresh token
  in the Mapbox dashboard.
- **`redirect_uri_mismatch` on Google sign-in** turned out to be a genuinely missing entry in
  Google Cloud Console's Authorized Redirect URIs list (only the production Render URL was
  registered, not the local one) — confirmed by decoding Google's own error response, which
  echoes back the exact `redirect_uri` it received and rejected. Resolved by adding the local
  callback URL as an additional authorized entry (both can coexist).
- **Confirmed working end-to-end, with real infrastructure, not just mocked/local:** admin login;
  live socket data (Dashboard's Recent Allocations correctly rendering `Restaurant → Customer`,
  confirming Priority 6 against real allocation events); rider creation via the new dialog with
  validation; Google OAuth sign-in completing successfully with the corrected `role: 'partner'`
  default; and the full OTP email flow — registration and forgot-password — with the code
  actually delivered to a real Gmail inbox via a real app-password-authenticated SMTP connection
  (tested first against Ethereal's fake-inbox SMTP service, then against real Gmail).
- **Priority 1's fix also self-confirmed live**: logging out (a genuine, sustained disconnect)
  correctly showed the disconnect banner after the grace period; ordinary page loads and
  navigation did not produce false positives.

### Manual testing checklist

- [x] Refresh while logged in — disconnect banner should not flash
- [x] Log in — live socket data (map/dashboard) starts working
- [ ] Create several orders for the same restaurant/rider pair — watch for
      `[routing] route cache: X/Y hits` in server logs (blocked on the revoked Mapbox token being
      replaced with a valid one — route-fetching currently always fails and falls back, so no
      cache hits are possible to observe yet)
- [x] Riders: "Add rider" — empty submit shows inline errors + disabled Save; map click updates
      lat/lng fields; save succeeds and the rider appears in the table
- [x] Riders: "Current order" shows `Restaurant → Customer`; Total orders / Orders (1h) populate
      after deliveries complete
- [ ] Restaurants/Customers: same validation + map-picker behavior as Riders
- [ ] Customers: shopping-bag icon → redirected to Orders with a restaurant-selection dialog
      pre-filled with that customer; existing "Create order"/"Bulk create" buttons still work
      unchanged
- [x] Register a new account → OTP delivered via real Gmail → verify → lands on dashboard
- [x] Forgot-password flow end to end, with a real emailed code, against a real Gmail inbox
- [x] Google login → new users get `role: 'partner'` (not admin); confirmed via direct database
      inspection after a fresh sign-in

### Assumptions

- "Google routing requests" in the original request referred to this project's actual Mapbox
  Directions integration — there is no Google Maps/Routes API anywhere in this codebase.
- Reverse geocoding for `LocationPicker` was explicitly skipped (no existing infra; optional per
  the original request).
- Priority 8's utilization and distance-travelled metrics are deferred — the underlying data
  isn't tracked anywhere yet.
- Real OTP email delivery requires the user to supply real SMTP credentials; the flow is fully
  testable in dev via the console-log fallback without them.
