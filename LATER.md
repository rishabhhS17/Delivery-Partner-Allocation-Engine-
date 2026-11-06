# Later: features deliberately left out for now

**Updated:** 2026-11-07

Features that were planned, discussed and then held back so the product stays simple enough
to explain end to end. Each entry says what it is, why it waits, and what building it needs.

---

## Load-test sliders (was commit 20, decision K2)

**Status:** not built. The detailed build plan is in [EXECUTION.MD](EXECUTION.MD).

### What it is

Two sliders in a drawer on the Rider Map, so a dinner rush can be created on demand and the
engine watched as it copes.

**Riders online (0 to 200).** The database holds a pool of 200 rider bots; 32 start online.
Nothing is created or deleted at runtime: the slider only flips each rider's online/offline
field, the same field the Riders page already toggles. Customers are untouched.

- **Raise it:** random offline riders come online at their last saved position and can be
  offered orders at once.
- **Lower it:** idle riders go offline first. If that is not enough, busy riders are marked
  *draining*: they leave the search index (no new or clubbed orders), finish what they carry,
  then go offline. No delivery in progress is ever dropped.
- **Raise it again:** draining riders are pulled back first, before anyone new is woken.
- **On restart** the slider starts at however many riders are already online, so a redeploy
  never moves the fleet by surprise.

**Orders per minute (0 to 30, default 0.1 = one every 10 minutes).** Every second the
generator draws how many orders arrive from a Poisson distribution (mean = rate ÷ 60), so
orders come in natural clumps, like real traffic, instead of evenly spaced. For scale: 200
riders deliver about 7–8 orders a minute, so 20 a minute clearly overloads them.

### Worked example: a big backlog, then riders cut

200 riders online, a large queue, slider moved to 32:

1. No rider is idle (all are carrying orders), so 168 riders are marked draining at once and
   stop receiving work. The drawer shows: target 32, online 200, going offline 168.
2. Over the next 5–20 minutes each draining rider finishes their one or two orders and goes
   offline; online falls 200 → 150 → 80 → 32.
3. The 32 remaining riders keep working. Orders they cannot reach are cancelled with reason
   `no_rider` once they pass their time limit. The queue empties by cancellation, not
   delivery.

Nothing crashes and no delivery in progress is lost: the city simply has too few riders, and
customers see "no delivery partner available".

**How big the queue can get.** An order waits at most its prep time (5–15 min) plus the
3-minute TTL. At the slider's maximum of 30 orders a minute that is about 30 × 18 ≈ 540
orders. A queue of thousands only happens by pressing "bulk create 100" dozens of times.

### Why it waits

- It is the most complex feature to explain (draining, the fleet planner, Poisson arrivals),
  and the product needs to be explainable end to end first.
- The robustness work it was meant to measure (Build 2: wake-up list, nearest-50 scoring,
  capped queues) is built without it; its effect can be shown with bulk orders instead.

### What building it needs

1. The plan in [EXECUTION.MD](EXECUTION.MD): a 200-rider seeded pool, a pure fleet planner
   (who goes online / offline / drains / un-drains), a `draining` flag on the live rider,
   a `poissonDraw` order loop, `GET`/`PUT /api/config/load`, and the drawer UI.
2. Open to every logged-in user (decision D1: no role checks), not admin-only as the
   original plan said.
3. The presenter drawer (commit 35) is the natural home: add the sliders as a second section.

### Possible follow-up: refuse orders when overloaded

Real platforms do not queue thousands of orders; when riders are scarce they stop taking
orders ("high demand, not accepting orders right now"). If the sliders are built, consider
refusing new orders at intake when waiting orders per online rider passes a limit. This is a
new decision, not part of K2.

---

## Already decided as later (from DECISIONS_MADE.md, decision J1)

Stage B (stateless API processes + one dispatcher, connected by Redis), Postgres, TypeScript,
a Trip model, duration-paced movement, batch matching, admin-only controls + RBAC, a
changed-riders-only stream, Prometheus, delivery OTP, and acceptance-rate scoring. These are
listed with their triggers in the README's Next Steps.
