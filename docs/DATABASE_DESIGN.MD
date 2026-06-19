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
| `rating`             | Number    | yes      | 1–5, default 4                                               |
| `availabilityStatus` | Enum      | yes      | `ONLINE` / `OFFLINE` — shift state a human partner toggles   |
| `status`             | Enum      | yes      | `IDLE` / `ACCEPTED` / `PICKED_UP` — movement state machine   |
| `activeOrders`       | Number    | yes      | Count of active orders (0 or 1 with one-at-a-time)           |
| `currentOrderId`     | ObjectId  | no       | Ref → `orders`, the order currently being delivered          |
| `isSimulated`        | Boolean   | yes      | `true` for dummy riders, `false` for real logged-in partners |
| `createdAt`          | Date      | yes      | Creation timestamp                                           |

> A rider is eligible for allocation only when `availabilityStatus === 'ONLINE'`
> **and** `status === 'IDLE'`.

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
| `route`             | Array     | no       | Current leg as `[{lat,lng}, {lat,lng}]` for animation       |
| `progress`          | Number    | no       | 0–1 progress along the current leg                          |
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
| `breakdown`            | Mixed    | no       | Per-factor sub-scores (distance/rating/load + raw km)  |
| `candidatesConsidered` | Number   | no       | How many eligible riders were scored                   |
| `createdAt`            | Date     | yes      | Decision timestamp                                     |

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

## 5. Suggested Indexes

| Collection          | Index                                   | Why                                          |
|---------------------|-----------------------------------------|----------------------------------------------|
| `riders`            | `{ availabilityStatus: 1, status: 1 }`  | Fast lookup of eligible (ONLINE+IDLE) riders |
| `orders`            | `{ status: 1, createdAt: 1 }`           | FIFO queue scan of `PENDING` orders          |
| `orders`            | `{ assignedRiderId: 1, deliveredAt: 1 }`| Recent-load aggregation for fairness scoring |
| `restaurants`       | `{ isActive: 1 }`                        | Random active-restaurant selection           |
| `customers`         | `{ isActive: 1 }`                        | Random active-customer selection             |
| `allocationhistory` | `{ orderId: 1 }`                         | Look up the decision for a given order        |
