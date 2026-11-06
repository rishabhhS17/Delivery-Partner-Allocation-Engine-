# Load-test knobs: riders online + orders per minute

> **Update 2026-11-02, not built yet.**
> - **Admin-only writes are dropped.** DECISIONS D1 now means no role checks, so ignore
>   `requireAdmin`, its 403 test and the disabled sliders for non-admins below. The knobs are
>   open to every logged-in user, like every other control.
> - **When and where it gets built** is open as DECISIONS K2. The recommendation is inside
>   build 1, in one drawer shared with the presenter panel.
> - **Cost guards** for running at 30 orders/min are open as K3 (database size) and K4
>   (Mapbox quota).

## Context

You want to stress the engine live: control how many riders are available and how fast
orders arrive, so a demand spike (dinner rush, rain) can be created on demand and its effect
watched. Today that isn't possible:
- 32 seeded riders, and availability can only be flipped one rider at a time.
- That flip (`riderController.updateStatus`) only writes Mongo. The live sim state
  (`riderState`, `h3Buckets` in `simulationEngine.js`) never hears about it until Stop→Start
  re-hydrates. **This is a bug, and the new knob would hit it too.**
- Orders auto-generate on a fixed 10-minute `setInterval` (`AUTO_ORDER_INTERVAL_MS`).

Decisions you approved: **online target over a pool** (riders log in/out, nothing is created
or deleted at runtime), **riders + orders/min**, **pool of ~200**, **drawer on the Rider Map**,
**admin-only writes**.

## Behaviour

**Riders-online knob (0 to 200).** It controls all riders; every rider is a bot (DECISIONS B3).
- Raise the target: random OFFLINE riders go ONLINE at their last saved position
  and become candidates immediately.
- Lower the target: random **IDLE** riders go OFFLINE at once. If that isn't enough, busy
  riders are marked **draining**. They leave the H3 index right away (no new or clubbed
  orders), finish what they carry, then go OFFLINE instead of re-indexing (hook in `_goIdle`).
- Raising the target again un-drains draining riders first, before waking offline ones.
- On boot the target starts at the number of riders already ONLINE, so a restart never moves
  the fleet by surprise.

**Orders-per-minute knob (0 to 30, step 0.5; default 0.1 = today's one every 10 min).**
- A 1-second loop draws the number of new orders from a **Poisson distribution** with mean
  rate÷60. Arrivals come in natural clumps like real traffic, not evenly spaced.
- For scale: 200 riders deliver roughly 7–8 orders/min, so 20/min clearly overloads them.

**Both knobs** are kept in memory, like the other config knobs (weights, TTL, H3). Rider
availability itself is persisted in Mongo as today.

There is no stopped state (B1: no Start/Stop; the sim always runs), so the knobs always take
effect in memory immediately.

## Backend changes

1. **`backend/src/config/constants.js`**: add `RIDER_POOL_SIZE = 200` and
   `getLoadConfig` / `setLoadConfig({ ridersOnlineTarget, ordersPerMinute })`. Follow the
   existing validate-and-throw pattern of `setOrderTtl` / `setH3Config` (lines 57–103).
   Replace `AUTO_ORDER_INTERVAL_MS` with a default rate.
2. **New `backend/src/services/fleetPlanner.js`** (pure, no DB). `planFleetChange(riders, target)`
   returns `{ goOnline, goOffline, drain, undrain }`. All selection logic lives here so it can
   be unit-tested.
3. **`backend/src/services/simulationEngine.js`**:
   - `applyRidersTarget(target)` runs the planner, writes changes with one `Rider.updateMany`
     per direction, then adds or removes riders in memory. Reuse the existing private helpers
     `_buildEntry` (397), `_addToH3` / `_removeFromH3` (809/816) and `_syncIndex` (830).
   - A `draining` flag on the rider entry. `_syncIndex` never indexes a draining rider.
     `_goIdle` (720) sends a draining rider OFFLINE instead of home and re-indexed.
   - `applyAvailability(riderId, status)` handles a single manual toggle through the same paths.
   - Call `applyRidersTarget` after `hydrate()` on start. While stopped, write only to the DB
     (hydrate picks it up).
   - `getStatus()` and the `simulation:tick` payload (508) gain a `load` object:
     `{ target, online, idle, busy, draining, poolSize, ordersPerMinute }`.
4. **`backend/src/services/orderGenerator.js`**: replace the fixed interval (85–102) with a
   1 s loop and an exported pure `poissonDraw(mean)`. `setOrderRate()` takes effect on the
   next second, with no restart needed.
5. **`backend/src/controllers/riderController.js` `updateStatus` (105–122)**: after the DB write,
   call `simulationEngine.applyAvailability`. This fixes the bug where manual toggles never
   reached live state.
6. **`backend/src/middleware/authMiddleware.js`**: add `requireAdmin`. It runs after `protect`,
   returns 403 unless `req.user.role === 'admin'`, and is applied only to the new PUT.
7. **`backend/src/routes/config.js`**:
   - `GET /api/config/load` is open to any logged-in user.
   - `PUT /api/config/load` requires admin. It calls `setLoadConfig`, then `applyRidersTarget`
     and `setOrderRate`, and returns 400 `{message}` on bad input (the same pattern as `/ttl`).
8. **Seeding**:
   - `backend/seed.js` and `reseed.js` top the pool up to `RIDER_POOL_SIZE` riders.
   - Names are generated as first × last-name combinations from the existing name lists.
   - Positions are random within `RANCHI_BOUNDS`.
   - Only the first 32 start ONLINE; the rest start OFFLINE.
   - `seed.js` changes from "skip if any riders exist" to "add the missing ones".

## Frontend changes

- **`frontend/src/api/endpoints.js`**: add `getLoadConfig()` and `setLoadConfig(body)`.
- **`frontend/src/context/SimulationContext.jsx`**: expose `load` from `simulation:tick`.
- **New `frontend/src/components/map/LoadTestDrawer.jsx`**: a collapsible panel.
  - Two MUI `Slider`s that save on release (`onChangeCommitted`), so dragging doesn't flood the API.
  - Live readouts: online / target, idle, busy, going offline, queue depth, orders/min.
  - For non-admins (`user.role` from `AuthContext`) the sliders are disabled with a tooltip.
- **`frontend/src/pages/RiderMap.jsx`**: mount the drawer. It's built so the build-5 presenter
  buttons (DECISIONS I2) can join it later.

## Tests (`node --test src/tests/*.test.js`)

- `setLoadConfig`: accepts in-range values, rejects negative, above-pool and non-number values.
- `planFleetChange`:
  - Raising the target wakes the right number of OFFLINE riders.
  - Lowering it takes IDLE riders first, then drains busy ones.
  - Raising it again un-drains riders before waking new ones.
- `poissonDraw`: a mean of 0 returns 0, and the sample mean over many draws is within tolerance.
- `requireAdmin`: a partner gets 403, an admin passes to `next()`.

## Verification (end to end)

1. Run `npm test` in `backend/` and confirm everything passes.
2. Run `node seed.js` and confirm 200 riders, with 32 ONLINE.
3. Start the backend and frontend, log in as admin, and open the Rider Map:
   - Set riders to 200. About 200 dots appear and readouts show online = 200.
   - Set riders to 10 and orders/min to 20. Idle dots vanish at once and busy ones finish
     their order and then vanish. Queue depth climbs, and orders cancel at the 180 s TTL.
   - Set them back to normal. The queue drains.
4. Log in as a partner: the sliders are disabled, and a `curl` PUT to `/api/config/load` with
   the partner's token returns 403.
5. Toggle one rider OFFLINE through `PUT /api/riders/:id/status`. It disappears from the map
   without a sim restart (bug fix).

**Mapbox note:** each assignment makes one or two route calls. A 10-minute spike at 20/min is
about 200–400 calls, well inside the free tier.

**No git commits** without asking first.
