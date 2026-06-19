# Delivery Partner Allocation Engine Workflow

## End-to-End Workflow

1. Admin logs into the system.
2. Admin creates a new order with restaurant and customer coordinates.
3. The order is stored with status = `pending`.
4. Admin explicitly triggers allocation using `POST /allocate-order`.
5. The system retrieves all eligible riders.
6. The allocation engine calculates scores for each rider.
7. The highest-scoring rider is selected.
8. The selected rider is assigned to the order.
9. The order status is updated to `active`.
10. Gemini generates a human-readable explanation.
11. The allocation event is stored in `AllocationHistory`.
12. The dashboard and map update to reflect the new assignment.

---

## Order Allocation Trigger

Allocation is not automatically triggered when an order is created.

Allocation occurs only when the administrator calls:

```http
POST /allocate-order
```

---

## Rider Eligibility Rules

A rider is eligible for allocation only if:

```text
availabilityStatus = "available"
```

Riders with the following statuses are excluded:

* `busy`
* `offline`

---

## Scoring Factors

The allocation engine evaluates each eligible rider using four factors.

| Factor       | Weight | Optimization Goal         |
| ------------ | ------ | ------------------------- |
| Distance     | 40%    | Lower is better           |
| Rating       | 30%    | Higher is better          |
| Current Load | 20%    | Lower is better           |
| Availability | 10%    | Available = maximum score |

---

## Distance Calculation

The system uses the Haversine formula to calculate the great-circle distance between:

```text
Rider Location → Restaurant Location
```

Distance is measured in kilometers.

---

## Score Normalization

All scoring factors must be normalized to a range between:

```text
0.0 to 1.0
```

This ensures fair weighting across factors.

---

## Allocation Formula

```text
Final Score =
(0.40 × Distance Score) +
(0.30 × Rating Score) +
(0.20 × Load Score) +
(0.10 × Availability Score)
```

The rider with the highest final score is assigned to the order.

---

## Tie-Breaking Rules

If two or more riders have the same final score, apply the following rules in order:

1. Lower distance wins.
2. Higher rating wins.
3. Lower activeOrders wins.
4. Earlier creation timestamp wins.

---

## AI Explanation Rules

The AI does not participate in rider selection.

The allocation engine determines the winning rider first.

Gemini receives:

* Selected rider details
* Runner-up rider details
* Distance values
* Ratings
* Active order counts
* Final score

Gemini generates a concise explanation describing why the selected rider was chosen.

Example:

> Rahul was selected because he is the closest available rider at 1.2 km, has a rating of 4.7, and currently has only one active delivery.

---

## Allocation Persistence Rules

The system persists only:

* Order ID
* Selected Rider ID
* Final Allocation Score
* AI Explanation
* Timestamp

The system does not persist individual scores for all evaluated riders.

Allocation history is append-only and must never be deleted.

---

## Error Scenarios

### No Eligible Riders

Return:

```http
404 Not Found
```

Message:

```json
{
  "message": "No available riders found."
}
```

### Invalid Coordinates

Return:

```http
400 Bad Request
```

### Missing Rider Location

Exclude the rider from evaluation.

### Allocation Failure

Return:

```http
500 Internal Server Error
```

The order remains in the `pending` state.

---

## Order Status Lifecycle

```text
pending → active → completed
```

* `pending`: Order created but not assigned
* `active`: Rider assigned and delivery in progress
* `completed`: Delivery finished

---

## Rider Status Lifecycle

```text
available ↔ busy ↔ offline
```

* `available`: Eligible for allocation
* `busy`: Currently handling deliveries
* `offline`: Not accepting deliveries
