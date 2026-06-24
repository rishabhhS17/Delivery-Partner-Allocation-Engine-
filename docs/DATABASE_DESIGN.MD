# Delivery Partner Allocation Engine — Database Design

## 1. Overview

The system uses **MongoDB** (via Mongoose) with five collections:

| Collection           | Managed by        | Purpose                                          |
|----------------------|-------------------|--------------------------------------------------|
| `riders`             | seed + partners   | Delivery partners, their location and state      |
| `restaurants`        | **admin (CRUD)**  | Pickup points orders are generated from          |
| `customers`          | **admin (CRUD)**  | Drop-off points / recipients orders are sent to  |
| `orders`             | system + admin    | Orders, their lifecycle and assignment           |
| `allocationhistory`  | system            | Audit trail of every allocation decision         |

`restaurants` and `customers` are both **admin-maintained reference data**. When an
order is created, the system picks **one random active restaurant** and **one random
active customer** from these collections, and snapshots their details onto the order.

---

## 2. Collections

### 2.1 `riders`

| Field                | Type      | Required | Notes                                                        |
|----------------------|-----------|----------|--------------------------------------------------------------|
| `_id`                | ObjectId  | auto     | Primary key                                                  |
| `name`               | String    | yes      | Rider name                                                   |
| `phone`              | String    | no       | Contact number                                               |
| `latitude`           | Number    | yes      | Current latitude                                             |
| `longitude`          | Number    | yes      | Current longitude                                            |
| `h3Index`            | String    | yes      | H3 cell at resolution 7 — pre-computed from lat/lng, used for geo-filter lookups |
| `rating`             | Number    | yes      | 1–5, default 4                                               |
| `availabilityStatus` | Enum      | yes      | `ONLINE` / `OFFLINE` — shift state a human partner toggles   |
| `status`             | Enum      | yes      | `IDLE` / `ACCEPTED` / `PICKED_UP` — movement state machine   |
| `activeOrders`       | Number    | yes      | Count of active orders (0 or 1 with one-at-a-time)           |
| `currentOrderId`     | ObjectId  | no       | Ref → `orders`, the order currently being delivered          |
| `nextOrderId`        | ObjectId  | no       | Ref → `orders`; pre-assigned order queued for when this rider goes `IDLE` |
| `deliveryTimestamps` | [Date]    | no       | Timestamps of each completed delivery; used for `recentLoad` (count entries > now − 60 min). Append on `DELIVERED`; prune entries older than 60 min when reading. |
| `isSimulated`        | Boolean   | yes      | `true` for dummy riders, `false` for real logged-in partners |
| `createdAt`          | Date      | yes      | Creation timestamp                                           |

> A rider enters the geo-candidate pool when `availabilityStatus === 'ONLINE'`,
> regardless of movement `status` (`IDLE`, `ACCEPTED`, or `PICKED_UP` are all eligible).
> ETAR accounts for the time a busy rider needs to finish their current delivery before
> they can reach the new restaurant — a rider nearly done with a nearby drop-off can
> beat an idle rider who is farther away.

---

### 2.2 `restaurants`  *(admin-managed)*

The admin can add and remove restaurants. Removal is a **soft delete** (`isActive: false`)
so that historical orders referencing it are never broken.

| Field        | Type     | Required | Notes                                  |
|--------------|----------|----------|----------------------------------------|
| `_id`        | ObjectId | auto     | Primary key                            |
| `name`       | String   | yes      | Restaurant name                        |
| `phone`      | String   | no       | Contact number                         |
| `latitude`   | Number   | yes      | Pickup latitude                        |
| `longitude`  | Number   | yes      | Pickup longitude                       |
| `isActive`   | Boolean  | yes      | Default `true`; `false` = soft-deleted |
| `createdAt`  | Date     | yes      | Creation timestamp                     |

---

### 2.3 `customers`  *(admin-managed — NEW)*

The admin can add and remove customers. Each customer carries a fixed delivery
location. Removal is a **soft delete** (`isActive: false`) for the same integrity
reason as restaurants.

| Field        | Type     | Required | Notes                                  |
|--------------|----------|----------|----------------------------------------|
| `_id`        | ObjectId | auto     | Primary key                            |
| `name`       | String   | yes      | Customer name                          |
| `phone`      | String   | no       | Contact number                         |
| `address`    | String   | no       | Human-readable delivery address        |
| `latitude`   | Number   | yes      | Drop-off latitude                      |
| `longitude`  | Number   | yes      | Drop-off longitude                     |
| `isActive`   | Boolean  | yes      | Default `true`; `false` = soft-deleted |
| `createdAt`  | Date     | yes      | Creation timestamp                     |

---

### 2.4 `orders`

An order references both a restaurant and a customer **and snapshots their name and
coordinates**, so deleting either reference record later never orphans the order or
breaks the map.

| Field               | Type      | Required | Notes                                                       |
|---------------------|-----------|----------|-------------------------------------------------------------|
| `_id`               | ObjectId  | auto     | Primary key                                                 |
| `restaurantId`      | ObjectId  | yes      | Ref → `restaurants`                                         |
| `restaurantName`    | String    | yes      | **Snapshot** of restaurant name                            |
| `restaurantLat`     | Number    | yes      | **Snapshot** of pickup latitude                            |
| `restaurantLng`     | Number    | yes      | **Snapshot** of pickup longitude                           |
| `customerId`        | ObjectId  | yes      | Ref → `customers`                                          |
| `customerName`      | String    | yes      | **Snapshot** of customer name                              |
| `customerLat`       | Number    | yes      | **Snapshot** of drop-off latitude                          |
| `customerLng`       | Number    | yes      | **Snapshot** of drop-off longitude                         |
| `assignedRiderId`   | ObjectId  | no       | Ref → `riders`; null while `PENDING`                       |
| `status`            | Enum      | yes      | `PENDING` / `ASSIGNED` / `PICKED_UP` / `DELIVERED` / `CANCELLED` |
| `polyline`          | Array     | no       | Route geometry as `[{lat,lng}]` — two points (Phase 1 Haversine), full road polyline (Phase 2) |
| `leg1Duration_s`    | Number    | no       | Duration of leg 1 (rider → restaurant) in seconds at 40 km/h |
| `leg2Duration_s`    | Number    | no       | Duration of leg 2 (restaurant → customer) in seconds at 40 km/h |
| `legStartedAt`      | Date      | no       | Timestamp when current leg began; `progress = (now − legStartedAt) / legDuration_s` |
| `progress`          | Number    | no       | 0–1 progress along current leg — derived from `legStartedAt`, stored for WebSocket broadcast |
| `queuedAt`          | Date      | no       | When the order last entered `PENDING` queue — initial creation or re-queue after rider drop |
| `allocationScore`   | Number    | no       | Final score of the chosen rider                             |
| `allocationReason`  | String    | no       | Human-readable explanation                                  |
| `createdAt`         | Date      | yes      | When the order was created                                  |
| `assignedAt`        | Date      | no       | When a rider was assigned                                   |
| `pickedUpAt`        | Date      | no       | When the rider reached the restaurant                       |
| `deliveredAt`       | Date      | no       | When the order was delivered                                |

> The lifecycle timestamps power the analytics (average pickup and delivery time).

---

### 2.5 `allocationhistory`

One record per allocation decision — a full audit trail.

| Field                  | Type     | Required | Notes                                                  |
|------------------------|----------|----------|--------------------------------------------------------|
| `_id`                  | ObjectId | auto     | Primary key                                            |
| `orderId`              | ObjectId | yes      | Ref → `orders`                                        |
| `riderId`              | ObjectId | yes      | Ref → `riders` (the winner)                           |
| `allocationScore`      | Number   | yes      | Winning final score                                    |
| `allocationReason`     | String   | yes      | Explanation text                                       |
| `breakdown`            | Mixed    | no       | Per-factor sub-scores (ETAR/rating/load + raw ETAR seconds) |
| `candidatesConsidered` | Number   | no       | How many eligible riders were scored                   |
| `createdAt`            | Date     | yes      | Decision timestamp                                     |

---

### 2.6 `users`  *(auth — admin and delivery partners)*

One record per login. Partners link to a `Rider` document; admins do not.

| Field          | Type     | Required | Notes                                           |
|----------------|----------|----------|-------------------------------------------------|
| `_id`          | ObjectId | auto     | Primary key                                     |
| `email`        | String   | yes      | Unique; used as login username                  |
| `passwordHash` | String   | yes      | bcrypt hash — never store plaintext             |
| `role`         | Enum     | yes      | `'admin'` \| `'partner'`                        |
| `riderId`      | ObjectId | no       | Ref → `riders`; `null` for admin accounts       |
| `createdAt`    | Date     | yes      | Creation timestamp                              |

> **Seed:** create one admin user in `seed.js` (`email: admin@demo.com`, role: `admin`, `riderId: null`).
> Partner accounts are created manually (one per simulated rider is not required — partners log in to view their assigned delivery only).

---

## 3. Relationships

```
restaurants ──┐
              ├──< orders >──┬── assignedRiderId ──> riders
customers ────┘              └──< allocationhistory >── riders
```

- `orders.restaurantId` → `restaurants._id`
- `orders.customerId`   → `customers._id`
- `orders.assignedRiderId` → `riders._id`
- `allocationhistory.orderId` → `orders._id`
- `allocationhistory.riderId` → `riders._id`

All references are kept **alongside snapshots** of the fields the map needs, so the
system stays correct even if the referenced restaurant or customer is later removed.

---

## 4. Order Creation Flow

When an order is created (auto cron or admin action):

1. Select a **random active restaurant** from `restaurants` (`isActive: true`).
2. Select a **random active customer** from `customers` (`isActive: true`).
3. Snapshot both records' name and coordinates onto the new order.
4. Save the order with `status: PENDING`.
5. The allocation engine assigns a rider on the next tick (or queues it if none free).

> Both restaurants and customers should be seeded/placed within the Ranchi
> coordinate bounding box so they render sensibly on the map.

---

## 5. Partner Order Accept Flow

`PUT /orders/:id/accept` — called by a delivery partner to acknowledge their assigned order.

**Precondition:** `order.status === 'ASSIGNED'` and `order.assignedRiderId === req.user.riderId`

**What it writes:**
- `order.acceptedAt = now` (optional timestamp — added to Order schema if needed)
- Returns the updated order

**What it does NOT do:**
- Does not change `order.status` — status is driven by the simulation (ASSIGNED → PICKED_UP → DELIVERED)
- Does not interact with the in-memory simulation state
- Phase 1 simulated riders never call this endpoint; it exists for real partner logins only

---

## 6. Rider Position Write Strategy

Rider positions are updated in memory on every simulation tick — at 40 km/h a 2 km
leg is ~180 ticks. Writing to MongoDB on every tick would produce ~180× more writes
than necessary and add latency to the hot path. Instead, **position and `h3Index`
are written to MongoDB only at lifecycle events** — the moments when the state genuinely changes and
persistence is required:

| Event | Fields written |
|---|---|
| Rider assigned (→ `ACCEPTED`) | `latitude`, `longitude`, `h3Index`, `status`, `currentOrderId`, `activeOrders`; order: `status=ASSIGNED`, `assignedRiderId`, `assignedAt`, `leg1Duration_s`, `leg2Duration_s`, `legStartedAt`, `polyline` |
| Busy rider pre-assigned (`nextOrderId` set) | `rider.nextOrderId`; order: `status=ASSIGNED`, `assignedRiderId`, `assignedAt` |
| Rider reaches restaurant (→ `PICKED_UP`) | `latitude`, `longitude`, `h3Index`, `status`; order: `status=PICKED_UP`, `pickedUpAt`, `legStartedAt` (reset for leg 2) |
| Rider delivers (→ `IDLE`) | `latitude`, `longitude`, `h3Index`, `status`, `currentOrderId=null`, `activeOrders=0`; order: `status=DELIVERED`, `deliveredAt` |
| Rider goes `OFFLINE` while `ACCEPTED` | `rider.availabilityStatus=OFFLINE`, `status=OFFLINE`, `currentOrderId=null`; order: `status=PENDING`, `assignedRiderId=null`, `assignedAt=null`, `queuedAt=now` |
| Rider goes `OFFLINE` while holding `nextOrderId` *(enhancement)* | `rider.nextOrderId=null`; order: `status=PENDING`, `assignedRiderId=null`, `queuedAt=now` |
| Rider toggles `ONLINE` | `availabilityStatus=ONLINE`, `status=IDLE` |

This is 3–4 writes per delivery cycle. Between events, the **in-memory rider state**
(maintained by `simulation.js`) is the authoritative source for live position and
`h3Index`. The allocation engine reads from memory, not MongoDB, on every tick.

On server restart, MongoDB provides the recovery snapshot: all riders are loaded,
their `h3Index` fields are trusted as-is (they were written at the last lifecycle
event), and the in-memory structures are rebuilt.

---

## 7. Suggested Indexes

| Collection          | Index                                                    | Why                                                     |
|---------------------|----------------------------------------------------------|---------------------------------------------------------|
| `riders`            | `{ availabilityStatus: 1, h3Index: 1 }`                  | Cold-path geo-filter queries and recovery on restart    |
| `riders`            | `{ availabilityStatus: 1, status: 1 }`                   | Admin views filtering by availability + movement state  |
| `orders`            | `{ status: 1, createdAt: 1 }`                            | FIFO queue scan of `PENDING` orders                     |
| `orders`            | `{ assignedRiderId: 1, deliveredAt: 1 }`                 | Recent-load aggregation for fairness scoring            |
| `restaurants`       | `{ isActive: 1 }`                                        | Random active-restaurant selection                      |
| `customers`         | `{ isActive: 1 }`                                        | Random active-customer selection                        |
| `allocationhistory` | `{ orderId: 1 }`                                         | Look up the decision for a given order                  |
