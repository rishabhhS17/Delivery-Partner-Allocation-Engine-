# API Specification

## Base URL

Development:

```text id="w23q4t"
http://localhost:5000/api
```

All protected endpoints require a JWT token.

Example:

```http id="dkn8wq"
Authorization: Bearer <jwt_token>
```

Content type:

```http id="lkkkdo"
Content-Type: application/json
```

---

# Authentication

## POST /auth/login

Authenticate an administrator and return a JWT.

### Access

Public

### Request Body

```json id="8pn8kq"
{
  "email": "admin@example.com",
  "password": "password123"
}
```

### Success Response

```json id="nfeev2"
{
  "success": true,
  "token": "<jwt_token>"
}
```

### Error Responses

```http id="0sfbya"
400 Bad Request
401 Unauthorized
```

---

# Rider APIs

## POST /riders

Register a new rider.

### Access

Admin

### Request Body

```json id="zpgv8h"
{
  "name": "Rahul Sharma",
  "phone": "9876543210",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "rating": 4.7
}
```

### Success Response

```http id="dkbjjh"
201 Created
```

---

## GET /riders

Retrieve all riders.

### Access

Admin

### Query Parameters

Optional:

* availabilityStatus
* sortBy

### Success Response

```http id="l3ehf4"
200 OK
```

---

## GET /riders/:id

Retrieve a rider by ID.

### Access

Admin

### Success Response

```http id="e38rkk"
200 OK
```

### Error Response

```http id="yhn6o9"
404 Not Found
```

---

## PUT /riders/:id/location

Update rider GPS coordinates.

### Access

Rider

### Request Body

```json id="9rn0ur"
{
  "latitude": 12.9731,
  "longitude": 77.6012
}
```

### Success Response

```http id="wmjh3r"
200 OK
```

---

## PUT /riders/:id/status

Update rider availability status.

### Access

Rider

### Request Body

```json id="k6xh4t"
{
  "availabilityStatus": "available"
}
```

### Allowed Values

* available
* busy
* offline

### Success Response

```http id="uxjuy9"
200 OK
```

---

# Order APIs

## POST /orders

Create a new order.

### Access

Admin

### Request Body

```json id="r4s9zn"
{
  "restaurantLatitude": 12.9716,
  "restaurantLongitude": 77.5946,
  "customerLatitude": 12.9352,
  "customerLongitude": 77.6245
}
```

### Success Response

```http id="vv9v3y"
201 Created
```

---

## GET /orders

Retrieve all orders.

### Access

Admin

### Query Parameters

Optional:

* status

### Allowed Status Values

* pending
* active
* completed

### Success Response

```http id="khxyyz"
200 OK
```

---

## GET /orders/:id

Retrieve order details.

### Access

Admin

### Success Response

```http id="x6ut39"
200 OK
```

### Error Response

```http id="v26fwl"
404 Not Found
```

---

# Allocation APIs

## POST /allocate-order

Trigger rider allocation for a specific order.

### Access

Admin

### Request Body

```json id="k8q6pq"
{
  "orderId": "6654c2b123456789abcdef01"
}
```

### Success Response

```json id="0m4ovw"
{
  "success": true,
  "orderId": "6654c2b123456789abcdef01",
  "assignedRiderId": "6654c2b123456789abcdef02",
  "allocationScore": 0.87,
  "allocationReason": "Rahul was selected because he is the closest available rider with a high rating and low workload."
}
```

### Error Responses

```http id="jws1cr"
400 Bad Request
404 Not Found
500 Internal Server Error
```

---

## GET /allocation-history

Retrieve historical allocation records.

### Access

Admin

### Query Parameters

Optional:

* orderId
* riderId

### Success Response

```http id="brdwud"
200 OK
```

---

# Standard Response Format

## Success

```json id="mq16i3"
{
  "success": true,
  "data": {}
}
```

## Error

```json id="d3rj0f"
{
  "success": false,
  "message": "Error description"
}
```

---

# Authentication Rules

Protected endpoints require:

```http id="v71l3s"
Authorization: Bearer <jwt_token>
```

Unauthenticated requests must return:

```http id="rsyy65"
401 Unauthorized
```

Unauthorized requests must return:

```http id="ocn5yl"
403 Forbidden
```
