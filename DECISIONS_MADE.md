# Decisions Made, in Commit Order

**Updated:** 2026-11-07

Every decision taken to fix this application, listed in the order the commits will land.
Every commit leaves the app working. The original options file (DECISIONS.md) was never
committed and is lost; the K-decision options were reconstructed and approved on 2026-11-07.
Work happens on the branch `feature/decisions-implementation`.

**Legend:** ✅ done · 🔨 to build

---

## Ready now: work already done

| # | Commit | Decisions | What it contains |
|---|---|---|---|
| 1 | `ADD DECISION DOCS AND NEXT STEPS` | all | DECISIONS.md, DECISION_CHOICES.md, this file, EXECUTION.MD, and the README roadmap + Next Steps ✅ |
| 2 | `SHOW NAMES INSTEAD OF IDS ON MAP` | — | Order hover shows the customer's name; rider hover shows the name and "N orders"; the rider popup lists every order carried; clubbed orders show their rider ✅ |
| 3 | `HARDEN PRODUCTION SESSION AND ANALYTICS` | D3 | Secure-only session cookie in production, Render's proxy trusted, the server refuses to start in production without `SESSION_SECRET`, and `/analytics` requires login ✅ |

## Build 1: Foundation

| # | Commit | Decisions | What it contains |
|---|---|---|---|
| 4 | `REMOVE SIMULATION START STOP` | B1 | The simulation runs whenever the server runs. Removes `POST /simulation/start` and `/stop` and the "simulation is stopped" 409 on new orders. `GET /simulation/status` stays 🔨 |
| 5 | `RUN TESTS ON EVERY PUSH` | K8 | A GitHub Action that runs `npm test`, so every later commit is checked 🔨 |
| 6 | `SPLIT ENGINE AND SIM FOLDERS` | Already decided, A3 | The engine and the bots move into separate folders. Bots may only call the engine's public commands, which get JSDoc types; a test enforces the wall. A first behaviour-preserving split of `simulationEngine.js` by job lands just before commit 4 🔨 |
| 7 | `MOVE DB ACCESS INTO STORAGE MODULE` | A2, E2 | All database access goes through one module. "Who carries this order" lives only on the Order; a rider's order list is rebuilt from orders on restart, and the orphan-healing code goes away 🔨 |
| 8 | `SAVE ASSIGNMENT BEFORE BROADCASTING IT` | Stage A (A1), E2 | Each assignment is one conditional single-document update; nothing is broadcast until it is saved 🔨 |
| 9 | `REWRITE RIDER BOT MOVEMENT` | B2, B3, B4, B5 | Every rider is a bot; the bot follows the engine's route; an idle rider stays where they delivered; positions are rebuilt from route + trip start on restart; one save of final positions on shutdown (SIGTERM) 🔨 |
| 10 | `ADD 7 DAY ORDER EVENT LOG` | C2 | An append-only event record per order change, deleted automatically after 7 days 🔨 |
| 11 | `ADD SSE LIVE STREAM ENDPOINT` | C1, C3, K6 | A Server-Sent Events endpoint sends every rider every second plus order events; on reconnect the browser gets a fresh snapshot (K6) 🔨 |
| 12 | `SWITCH FRONTEND TO SSE STREAM` | C1 | The frontend switches from Socket.IO to a `fetch`-based stream reader that sends the existing token 🔨 |
| 13 | `REMOVE SOCKET.IO FROM APP` | Already decided | Removes Socket.IO from the backend, the frontend and the README 🔨 |
| 14 | `PAUSE ASSIGNMENTS WHEN DB DOWN` | E3 | Positions and the stream keep going; no decision is made unless it can be saved; resumes automatically 🔨 |
| 15 | `ADD LEADER LOCK FOR DEPLOYS` | E4 | During a Render deploy only the instance holding the lease in Mongo dispatches; the old one releases it at shutdown 🔨 |
| 16 | `CANCEL FAILING ORDERS, RESTART ON CRASH` | E1, E5 | An order that makes the engine throw is CANCELLED with a stored `cancelReason: 'engine_error'` (no separate NEEDS_ATTENTION status; changed 2026-11-07). The new `cancelReason` field on Order also records `'no_rider'` for TTL cancels. Any other unexpected error is logged, then the process exits and Render restarts it 🔨 |
| 17 | `ADD HEALTH METRICS AND JSON LOGS` | E6 | `/health` returns thread delay, tick time, queue sizes, time-to-assign and database latency; an "Engine health" card on the dashboard; logs as JSON lines with order and rider IDs 🔨 |
| 18 | `CLEAR ROUTE DATA AFTER DELIVERY` | K3 | Route lines cleared when an order finishes; allocation history expires after 7 days 🔨 |
| 19 | `SHOW RIDER ON CLUBBED ORDER PAGE` | K7 | The rider and their current leg, labelled "Delivering another order first" 🔨 |
| 20 | `SYNC RIDER AVAILABILITY TO ENGINE` | — | Only the bug fix from the old load-test commit: turning a rider online/offline on the Riders page reaches the live engine at once. The load-test sliders (K2) moved to [LATER.md](LATER.md) on 2026-11-07 🔨 |

## Build 2: Robustness

| # | Commit | Decisions | What it contains |
|---|---|---|---|
| 21 | `ADD WAKE-UP LIST FOR JIT` | F1 | Waiting orders sleep in one list sorted by wake-up time and are scored ~2–3 times instead of every second 🔨 |
| 22 | `SHRINK DISPATCH SEARCH AND RETRIES` | F1 | Search ring computed from the max range (k≈3) and the Settings knob removed; only the nearest 50 riders scored; retries back off 1 → 2 → 4 → 10 s; most urgent deadline goes first 🔨 |
| 23 | `SAVE TIMERS AS TIMESTAMPS` | E1 (rest) | Timers survive restarts 🔨 |
| 24 | `MAKE RIDER STEPS RETRY SAFE` | E1 (rest) | A repeated "picked up" or "delivered" is a no-op success 🔨 |
| 25 | `CAP QUEUES AND DELIVERY HISTORY` | E1 (rest) | Memory stays bounded under load 🔨 |
| 26 | `LIMIT MAPBOX CALLS PER DAY` | E1 (rest), K4 | Past the daily budget, new routes use the existing straight-line fallback; `/health` shows the count 🔨 |

## Build 3: Rider lifecycle

| # | Commit | Decisions | What it contains |
|---|---|---|---|
| 27 | `ADD RIDER OFFER ACCEPT REJECT` | G3 | 30 s offer timeout; 3 ignored offers in a row → auto-offline; a rider who rejected is never re-offered that order 🔨 |
| 28 | `SEND CLUBBED ORDERS AS OFFERS` | K5 | The rider keeps riding while the offer is open; on reject the order goes back to the queue 🔨 |
| 29 | `WIDEN SEARCH WHEN RIDERS REJECT` | G1 | 5 → 7 → 10 km at 60 s and 120 s, then cancel when the order's TTL runs out 🔨 |
| 30 | `ADD RIDER CANCELLATIONS` | G2 | A rider can cancel only before pickup; the order is reassigned. Cancelling after pickup is not modelled (dropped 2026-11-04: rare in practice) 🔨 |
| 31 | `ADD RIDER BOT BEHAVIOR RATES` | G4 | Replies in 2–8 s; 15% reject, 5% ignore; 2% cancel before pickup; all adjustable live in Settings, 0% = perfect bot 🔨 |

## Build 4: Kitchen and order intake

| # | Commit | Decisions | What it contains |
|---|---|---|---|
| 32 | `ADD KITCHEN BOT PREP TIMES` | H1 | The estimate is set on order, can be updated, and dispatch re-plans (the wake-up list re-sorts) whenever it changes 🔨 |
| 33 | `ADD EXTERNAL ORDER ID INTAKE` | H2 | A retried order returns the existing one, even after a restart; the upstream order service authenticates with its own key 🔨 |
| 34 | `ADD KITCHEN BOT BEHAVIOR RATES` | H3 | Restaurant rejects 2%; food delayed 10% (3–8 min, announced halfway through the estimate) or early 10% (1–3 min); all adjustable in Settings 🔨 |

## Build 5: Presenter panel

| # | Commit | Decisions | What it contains |
|---|---|---|---|
| 35 | `ADD PRESENTER PANEL DRAWER` | I2 | One drawer on the Rider Map (the load-test sliders can join it later, see [LATER.md](LATER.md)) 🔨 |
| 36 | `ADD EDGE CASE BUTTONS` | I3 | Rider rejects/ignores or cancels before pickup; restaurant rejects, delays or has food early; 60 s database outage (test hook only when `SIMULATION_ENABLED=true`) 🔨 |
| 37 | `ADD CRASH ENGINE BUTTON` | I1 | Wipes in-memory state and recovers from the database without exiting, using the same code as a real crash 🔨 |

---

## Decisions with no commit of their own

| ID | Decision |
|---|---|
| A1 | Stage A now (commits 4–26 are Stage A). Stage B is in README Next Steps, with its trigger |
| A2 | Stay on MongoDB |
| A3 | JavaScript with JSDoc on the engine's commands (applied in commit 6) |
| A4 | Render free tier; open the app ~5 minutes before presenting |
| D1 | No role checks for now; every logged-in user can do everything |
| G2 | Rider cancelling after pickup: dropped (rare in practice), so no flag or ops flow for it |
| H3 | Customer misbehaviour (cancelling at any stage, unreachable at the door): dropped. Swiggy and Zomato make it hard for customers to break an order, so customers only place orders (the order generator) |
| F4 | Keep `bcryptjs` |
| J1 | Stage B, Postgres, TypeScript, Trip model, duration-paced movement, batch matching, admin-only controls + RBAC, changed-riders-only stream, Prometheus, delivery OTP, acceptance-rate scoring: all deferred to README Next Steps |
| — | Real-rider location handling is not built; `TODO(real-riders)` comments mark where it plugs in |

## Resolved on 2026-11-07 (were open)

| ID | Question | Decision |
|---|---|---|
| K1 | Keep login now that there are no role checks? | Keep today's login (no commit) |
| K2 | When and where the load-test knobs get built | Not now: moved to [LATER.md](LATER.md) |
| K3 | Database filling up under load | Clear route lines on finish + 7-day allocation history (commit 18) |
| K4 | Mapbox quota under load | Daily budget, then straight lines (commit 26) |
| K5 | Clubbed order once offers exist | Same offer flow (commit 28) |
| K6 | What a reconnecting browser gets | Fresh snapshot, no replay (commit 11) |
| K7 | Single-order page for a clubbed order | Show the rider + current leg, labelled (commit 19) |
| K8 | Run tests automatically | GitHub Action on every push and PR (commit 5) |
