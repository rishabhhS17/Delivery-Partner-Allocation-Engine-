# Database Schema

Database: MongoDB Atlas

ODM: Mongoose

All collections must use:

* MongoDB ObjectId as the primary key
* `timestamps: true` in Mongoose schemas
* Validation rules
* Appropriate indexes

---

# Riders Collection

Collection Name:

```text id="vf1z9v"
riders
```

## Fields

| Field              | Type     | Required | Validation                 | Description                 |
| ------------------ | -------- | -------- | -------------------------- | --------------------------- |
| _id                | ObjectId | Yes      | Auto-generated             | Primary key                 |
| name               | String   | Yes      | Min: 2 characters          | Full name of rider          |
| phone              | String   | Yes      | Unique                     | Contact number              |
| latitude           | Number   | Yes      | Valid latitude range       | Current GPS latitude        |
| longitude          | Number   | Yes      | Valid longitude range      | Current GPS longitude       |
| rating             | Number   | Yes      | 1.0 - 5.0                  | Performance rating          |
| availabilityStatus | String   | Yes      | available | busy | offline | Current rider status        |
| activeOrders       | Number   | Yes      | Minimum: 0                 | Number of active deliveries |
| createdAt          | Date     | Yes      | Auto-generated             | Creation timestamp          |
| updatedAt          | Date     | Yes      | Auto-generated             | Last update timestamp       |

## Indexes

```text id="q0djlwm"
phone: unique
availabilityStatus: index
```

## Example Document

```json id="v0s6h8"
{
  "_id": "6654c2b123456789abcdef01",
  "name": "Rahul Sharma",
  "phone": "9876543210",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "rating": 4.7,
  "availabilityStatus": "available",
  "activeOrders": 1,
  "createdAt": "2026-06-01T10:00:00.000Z",
  "updatedAt": "2026-06-01T10:00:00.000Z"
}
```

---

# Orders Collection

Collection Name:

```text id="7omwuj"
orders
```

## Fields

| Field               | Type     | Required | Validation                   | Description           |
| ------------------- | -------- | -------- | ---------------------------- | --------------------- |
| _id                 | ObjectId | Yes      | Auto-generated               | Primary key           |
| restaurantLatitude  | Number   | Yes      | Valid latitude range         | Restaurant latitude   |
| restaurantLongitude | Number   | Yes      | Valid longitude range        | Restaurant longitude  |
| customerLatitude    | Number   | Yes      | Valid latitude range         | Customer latitude     |
| customerLongitude   | Number   | Yes      | Valid longitude range        | Customer longitude    |
| assignedRiderId     | ObjectId | No       | Reference: riders            | Assigned rider        |
| status              | String   | Yes      | pending | active | completed | Current order status  |
| createdAt           | Date     | Yes      | Auto-generated               | Creation timestamp    |
| updatedAt           | Date     | Yes      | Auto-generated               | Last update timestamp |

## Relationships

```text id="k1xvlj"
assignedRiderId → riders._id
```

## Indexes

```text id="0jz8mj"
status: index
assignedRiderId: index
```

## Example Document

```json id="s19jhd"
{
  "_id": "6654c2b123456789abcdef10",
  "restaurantLatitude": 12.9716,
  "restaurantLongitude": 77.5946,
  "customerLatitude": 12.9352,
  "customerLongitude": 77.6245,
  "assignedRiderId": "6654c2b123456789abcdef01",
  "status": "active",
  "createdAt": "2026-06-01T10:05:00.000Z",
  "updatedAt": "2026-06-01T10:05:00.000Z"
}
```

---

# AllocationHistory Collection

Collection Name:

```text id="dcmu31"
allocationHistory
```

## Fields

| Field            | Type     | Required | Validation             | Description           |
| ---------------- | -------- | -------- | ---------------------- | --------------------- |
| _id              | ObjectId | Yes      | Auto-generated         | Primary key           |
| orderId          | ObjectId | Yes      | Reference: orders      | Associated order      |
| riderId          | ObjectId | Yes      | Reference: riders      | Selected rider        |
| allocationScore  | Number   | Yes      | 0.0 - 1.0              | Final weighted score  |
| createdAt        | Date     | Yes      | Auto-generated         | Allocation timestamp  |
| updatedAt        | Date     | Yes      | Auto-generated         | Last update timestamp |

## Relationships

```text id="zkhcsq"
orderId → orders._id
riderId → riders._id
```

## Indexes

```text id="jj1vbw"
orderId: index
riderId: index
createdAt: descending index
```

## Data Integrity Rules

* Records are append-only.
* Historical allocations must never be deleted.
* Existing allocation records must never be updated.

## Example Document

```json id="gxhxmy"
{
  "_id": "6654c2b123456789abcdef20",
  "orderId": "6654c2b123456789abcdef10",
  "riderId": "6654c2b123456789abcdef01",
  "allocationScore": 0.87,
  "createdAt": "2026-06-01T10:06:00.000Z",
  "updatedAt": "2026-06-01T10:06:00.000Z"
}
```

---

# Restaurants Collection

Collection Name: `restaurants`

## Fields

| Field      | Type     | Required | Validation           | Description                             |
| ---------- | -------- | -------- | -------------------- | --------------------------------------- |
| _id        | ObjectId | Yes      | Auto-generated       | Primary key                             |
| name       | String   | Yes      | Min: 2 characters    | Restaurant name                         |
| phone      | String   | No       |                      | Contact number                          |
| latitude   | Number   | Yes      | Valid latitude range | Pickup latitude                         |
| longitude  | Number   | Yes      | Valid longitude range| Pickup longitude                        |
| h3Index    | String   | Yes      | H3 res 7             | Pre-computed from lat/lng at creation; used for service-area `$in` queries |
| isActive   | Boolean  | Yes      | Default true         | false = soft-deleted                    |
| createdAt  | Date     | Yes      | Auto-generated       | Creation timestamp                      |

## Indexes

```text
h3Index: 1, isActive: 1  (compound)
```

---

# Customers Collection

Collection Name: `customers`

## Fields

| Field      | Type     | Required | Validation            | Description                             |
| ---------- | -------- | -------- | --------------------- | --------------------------------------- |
| _id        | ObjectId | Yes      | Auto-generated        | Primary key                             |
| name       | String   | Yes      | Min: 2 characters     | Customer name                           |
| phone      | String   | No       |                       | Contact number                          |
| address    | String   | No       |                       | Human-readable delivery address         |
| latitude   | Number   | Yes      | Valid latitude range  | Drop-off latitude                       |
| longitude  | Number   | Yes      | Valid longitude range | Drop-off longitude                      |
| h3Index    | String   | Yes      | H3 res 7              | Pre-computed from lat/lng at creation; used for service-area `$in` queries |
| isActive   | Boolean  | Yes      | Default true          | false = soft-deleted                    |
| createdAt  | Date     | Yes      | Auto-generated        | Creation timestamp                      |

## Indexes

```text
h3Index: 1, isActive: 1  (compound)
```

---

# Users Collection

Collection Name: `users`

## Fields

| Field        | Type     | Required | Validation       | Description                                  |
| ------------ | -------- | -------- | ---------------- | -------------------------------------------- |
| _id          | ObjectId | Yes      | Auto-generated   | Primary key                                  |
| email        | String   | Yes      | Unique           | Login username                               |
| passwordHash | String   | Yes      |                  | bcrypt hash — never store plaintext          |
| role         | String   | Yes      | admin \| partner | Access level                                 |
| riderId      | ObjectId | No       | Ref: riders      | Linked rider; null for admin accounts        |
| createdAt    | Date     | Yes      | Auto-generated   | Creation timestamp                           |

---

# Coordinate Validation Rules

Latitude:

```text id="72a8d3"
-90 <= latitude <= 90
```

Longitude:

```text id="9bqovf"
-180 <= longitude <= 180
```

---

# Enumerations

## Rider Availability Status

```text id="uh2qgx"
available
busy
offline
```

## Order Status

```text id="4r6zpc"
pending
active
completed
```
