# Bugs

## 1. An order that could no longer keep its promise was never assigned (it was cancelled instead) — FIXED 2026-11-10

### What used to happen

Every order gets a promised delivery time when it is created (5 min first mile + prep + last mile + 10 min slack; see `utils/orderTiming.js`). The engine treated it as a **hard rule**: any plan that delivered *any* order after its promise was thrown out. So when no rider could make it in time, the order got no rider, retried, widened its search (which could not help: the problem was time, not distance), and was cancelled as `no_rider` 180 s after its food was ready, even though riders were in range.

It bit when the only free riders were far away and the order had already waited (rejections, ignored offers, a rider cancelling, a kitchen delay). Checked with the real functions, for a 3 km order promised 20.4 min after creation, could an idle rider still be assigned?

| Rider distance | At creation | After 3 min | After 6 min | After 10 min |
|---|---|---|---|---|
| 2 km | yes | yes | yes | yes |
| 5 km | yes | yes | yes | no |
| 7 km | yes | yes | no | no |
| 10 km | yes | no | no | no |

### The fix (approved 2026-11-10)

1. **The new order is never blocked by its own promise.** If it will be late, it is still assigned, and the cheapest rider, who is also the least late, wins. (`deadlineOk` now skips the order being added; `services/allocationEngine.js`.)
2. **Orders a rider already carries stay protected.** A second order still can't be fitted in any way that makes them miss their promise. Head freeze and the aging lock are unchanged.
3. **Simple cancel timer:** an order still unassigned **5 min after its food is ready** is cancelled (`no_rider`). Cooking time never counts against it (a 20-min order gets until minute 25), and a kitchen delay moves the window with it. An order a rider gives back gets a fresh 5 min from when it re-entered the queue, if that is later. Adjustable live in Settings. (`ORDER_TTL_MS` in `config/constants.js`, `_cancelExpiredOrders` in `engine/dispatch.js`.)

**Tests:** "a new order that will be late still gets a rider: the least-late one" (fails on the old code, passes now) and "a second order is never fitted in a way that makes an order already on board late" (`tests/clubbing.test.js`).

## 2. Two orders decided at the same moment are never clubbed, even when one rider could take both — OPEN

**Status:** to fix. The fix changes how dispatch works, so the options below need approval before any code is written.

### What happens

Seen live on 2026-11-10: two orders from the **same restaurant**, placed at the **same moment**, with the **same 45 s prep**, going to customers **300 m apart** in the same direction.

| Order | Offered | Assigned |
|---|---|---|
| Order 1 | Sreyannsh (110 m from the restaurant) at 30.3 s | Sreyannsh at 35.3 s |
| Order 2 | Aviral (2.3 km away) at 30.3 s | Aviral at 35.3 s |

One rider could have delivered both. Instead a second rider made a 2.3 km trip.

### Why

Two rules combine:
1. **Orders are decided one at a time** in each dispatch round (`runDispatchRound` in `engine/dispatchLoop.js`). Both orders woke in the same round. Order 1 went first and its best rider got the offer.
2. **A rider holds only one open offer at a time.** The filter step in `_chooseAssignment` (`engine/dispatch.js`) skips any rider with an open offer. So when order 2 was decided a moment later, the best rider for it was skipped, and the next best got it.

Clubbing only happens when the second order is decided **after** the first rider has accepted, for example when the orders arrive some seconds apart, or when there is no other rider nearby.

### Why it matters

Same-restaurant orders with similar ready times are the easiest batching win there is, and the engine misses them. Swiggy describes the opposite approach: group orders into **batches first**, then assign each batch to one rider ("Logistic Zones for Assignment", Swiggy Bytes).

### Options to decide before building

1. **Batch first:** before offering, group due orders from the same restaurant (or nearby restaurants) with similar food-ready times and compatible drops, the same checks as the clubbing gate. Offer the group to one rider as **one offer**; on accept, both are assigned; on reject, both go back to dispatch.
2. **Wait briefly for the answer:** if order 2's best rider is holding order 1's offer and is much cheaper than the next best rider, hold order 2 for a few seconds until that rider answers. If they accept, order 2 can then be clubbed onto them as usual.

### Test to add

Two same-restaurant orders created at the same instant with nearby drops, and two idle riders nearby: both orders must end up with the same rider.

## 3. A restaurant in the middle of a busy rider's route fails the clubbing check — OPEN

**Status:** to fix. The fix changes which riders can be offered a second order, so the approach needs approval before any code is written.

### What happens

The clubbing gate (`_clubbable` in `engine/dispatch.js`) lets a busy rider be considered for a second order only if the new restaurant is within **1.5 km of a point**: the rider's current position, or one of their stops. It never measures the distance to the **route between** those points.

Checked with the real engine code on 2026-11-10. Aman is carrying Riya's order, heading 8.9 km north; order B's customer is next to Riya.

| Where B's restaurant is | Result |
|---|---|
| 1.1 km ahead of Aman | offered to Aman |
| 4.4 km ahead, exactly on his way | **no rider**: more than 1.5 km from Aman and from Riya's drop |
| 7.8 km ahead, near Riya | **no rider**: fails earlier, because the range check measures 5 km from Aman's *current* position, not from where his route takes him |

### Why it matters

On short legs (most deliveries are 2–4 km) the 1.5 km circles around the rider and the stops overlap, so little is missed. On long legs the middle of the route is a blind spot, which is exactly where "on the way" pickups are.

### Fix to consider

- Measure the restaurant's distance to the **line segments** of the rider's route (current position → first stop → next stop …) instead of to the stops themselves. This is standard point-to-segment geometry and still cheap. The full route simulation (`cheapestInsertion`) still makes the final decision.
- Decide whether busy riders should also pass the range check when their **route** passes within range of the restaurant, not only their current position.

### Test to add

A busy rider with one long drop leg and a new restaurant on that leg, more than 1.5 km from both ends: the rider must pass the gate and be offered the order.
