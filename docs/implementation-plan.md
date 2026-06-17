# Implementation Plan

## Project: Delivery Partner Allocation Engine

This document defines the recommended implementation approach, milestones, architecture, dependencies, and development order.

The `docs/` directory is the source of truth for all implementation decisions.

---

# Monorepo Structure

```text
delivery-partner-allocation-engine/
├── frontend/
├── backend/
└── docs/
```

---

# Frontend Structure

Technology Stack:

* React 18
* Vite
* Material UI
* React Router DOM
* Axios
* Mapbox GL JS

```text
frontend/
├── public/
├── src/
│   ├── api/
│   │   ├── axios.js
│   │   └── endpoints.js
│   ├── assets/
│   ├── components/
│   ├── context/
│   │   └── AuthContext.jsx
│   ├── hooks/
│   ├── layouts/
│   ├── pages/
│   ├── routes/
│   │   ├── AppRoutes.jsx
│   │   └── ProtectedRoute.jsx
│   ├── services/
│   ├── utils/
│   ├── App.jsx
│   └── main.jsx
├── package.json
├── vite.config.js
└── .env.example
```

---

# Backend Structure

Technology Stack:

* Node.js
* Express.js
* MongoDB Atlas
* Mongoose
* JWT
* Gemini API

Architecture Pattern:

* MVC (Model-View-Controller)

```text
backend/
├── src/
│   ├── config/
│   │   ├── db.js
│   │   └── env.js
│   ├── controllers/
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   └── errorMiddleware.js
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── tests/
│   ├── utils/
│   ├── validators/
│   ├── app.js
│   └── server.js
├── package.json
└── .env.example
```

---

# Development Milestones

## Milestone 1: Project Scaffolding

Deliverables:

* Monorepo structure
* Vite setup
* Express setup
* MongoDB Atlas connection
* Environment variables
* Axios configuration
* JWT middleware skeleton

---

## Milestone 2: Authentication

Deliverables:

Backend:

* POST /auth/login
* JWT generation
* JWT verification middleware

Frontend:

* Login page
* AuthContext
* Protected routes
* Logout functionality

---

## Milestone 3: Rider Management

Deliverables:

Backend:

* Rider schema
* Rider APIs

Frontend:

* Rider table
* Status toggle
* Location display

Endpoints:

```text
POST /riders
GET /riders
GET /riders/:id
PUT /riders/:id/location
PUT /riders/:id/status
```

---

## Milestone 4: Order Management

Deliverables:

Backend:

* Order schema
* Order APIs

Frontend:

* Order table
* Create order form
* Status filtering

Endpoints:

```text
POST /orders
GET /orders
GET /orders/:id
```

---

## Milestone 5: Allocation Engine

Deliverables:

* Haversine distance utility
* Score normalization
* Weighted scoring algorithm
* AllocationHistory schema

Endpoints:

```text
POST /allocate-order
GET /allocation-history
```

Performance target:

```text
Allocation time < 500ms
```

---

## Milestone 6: AI Integration

Deliverables:

* Gemini service
* Prompt template
* Allocation explanations
* Retry and timeout handling

Constraint:

Gemini explains decisions only.

Gemini does not participate in rider selection.

---

## Milestone 7: Dashboard and Maps

Deliverables:

* KPI cards
* Allocation history page
* Mapbox integration
* Rider markers
* Restaurant and customer markers
* Route visualization

Pages:

* Dashboard
* Riders
* Orders
* Map
* History

---

## Milestone 8: Testing and Deployment

Deliverables:

* Unit tests
* Integration tests
* End-to-end tests
* Production deployment

Deployment targets:

* Frontend → Vercel
* Backend → Render
* Database → MongoDB Atlas

---

# External Dependencies

## Mapbox API

Purpose:

* Rider visualization
* Order visualization
* Route rendering

## Gemini API

Purpose:

* Human-readable allocation explanations

## MongoDB Atlas

Purpose:

* Cloud database hosting

---

# Environment Variables

## Backend

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=
JWT_SECRET=
JWT_EXPIRES_IN=7d
GEMINI_API_KEY=
CLIENT_URL=http://localhost:5173

ADMIN_EMAIL=
ADMIN_PASSWORD=
```

---

## Frontend

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPBOX_ACCESS_TOKEN=
VITE_APP_NAME=Delivery Partner Allocation Engine
```

---

# Recommended Development Order

1. Project scaffolding
2. Authentication
3. Rider management
4. Order management
5. Allocation engine
6. AI integration
7. Dashboard and maps
8. Testing and deployment

Each milestone must be completed, tested, and committed before moving to the next milestone.

---

# Coding Standards

Backend:

* MVC architecture
* Service layer for business logic
* Centralized error handling
* Request validation middleware

Frontend:

* Feature-based organization
* Reusable components
* Context API for authentication
* Centralized API services

General:

* Environment variables for configuration
* Atomic commits
* Comprehensive testing
* Clear documentation
