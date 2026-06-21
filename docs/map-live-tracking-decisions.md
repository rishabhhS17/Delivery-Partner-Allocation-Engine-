# Live Map Tracking Decisions

This document records the agreed decisions for the live map feature in the Delivery Partner Allocation Engine. It is meant to remove ambiguity before implementation starts, especially around marker movement, route rendering, API key handling, geocoding, marker performance, and WebSocket reconnect behavior.

## Current Scope

The live map feature is for the admin/internal dashboard used by the project team.

For the current demo:

- Rider locations are simulated, not real GPS.
- Restaurant, customer, and rider coordinates are already stored as latitude/longitude.
- Routes are visualized as straight-line paths.
- The map provider is Mappls.
- The frontend will use Mappls Web Map SDK features for map rendering, markers, polylines, and InfoWindows.
- WebSocket updates will keep rider/order positions live after the initial map state is loaded.

## Current Project Structure In This Context

This section explains how the existing project parts relate to the map feature.

### Backend Entry Flow

```text
backend/src/server.js
-> imports backend/src/app.js
-> connects MongoDB
-> starts Express server
```

`backend/src/app.js` sets up:

- CORS
- JSON parsing
- URL-encoded parsing
- All API routes under `/api`
- Not found handler
- Error handler

Main API mounting happens in:

```text
backend/src/routes/index.js
```

Current mounted routes relevant to maps:

```text
/api/riders
/api/restaurants
/api/customers
/api/orders
/api/map
/api/simulation
/api/allocate-order
```

### Frontend Entry Flow

```text
frontend/src/main.jsx
-> renders frontend/src/App.jsx
```

At the time of this document, `frontend/src/App.jsx` is still a skeleton. This means the frontend map screens still need to be built.

Existing frontend API files:

```text
frontend/src/api/axios.js
frontend/src/api/endpoints.js
```

`axios.js` already creates an Axios instance with:

```text
VITE_API_BASE_URL or http://localhost:5000/api
```

`endpoints.js` is still empty/TODO, so map endpoints should be added there during frontend implementation.

## How The Map Feature Connects End To End

The live map feature should be understood as a pipeline:

```text
MongoDB models
-> backend services
-> backend REST snapshot API
-> backend WebSocket live events
-> frontend map state
-> Mappls markers/polylines/InfoWindows
```

### Data Source Layer

These backend models provide the data shown on the map:

```text
backend/src/models/Rider.js
backend/src/models/Order.js
backend/src/models/Restaurant.js
backend/src/models/Customer.js
```

`Rider` provides:

- Current latitude
- Current longitude
- Availability status
- Delivery status
- Current order ID
- Active order count
- Whether rider is simulated

`Order` provides:

- Restaurant coordinates
- Customer coordinates
- Assigned rider ID
- Order status
- Route points
- Route progress
- Allocation score/reason

`Restaurant` provides:

- Restaurant name
- Restaurant coordinates
- Active/inactive state

`Customer` provides:

- Customer name
- Customer address
- Customer coordinates
- Active/inactive state

### Allocation Layer

Allocation happens in:

```text
backend/src/services/allocationService.js
```

When an admin allocates an order:

1. The order must be `PENDING`.
2. Eligible riders are selected using:

```text
availabilityStatus = ONLINE
status = IDLE
```

3. The service scores riders using distance, rating, and load.
4. The winning rider is assigned to the order.
5. The order changes to:

```text
ASSIGNED
```

6. The rider changes to:

```text
ACCEPTED
```

7. The first route is created:

```text
rider current location -> restaurant location
```

This allocation result is what makes an order appear as active on the order map.

### Distance Layer

Distance helpers live in:

```text
backend/src/services/distanceService.js
backend/src/utils/geo.js
```

`geo.js` contains:

- Haversine distance
- Point interpolation

`distanceService.js` can use Mappls distance if configured, but it also falls back to Haversine.

For the current map display, the important decision is:

```text
The visual route line is straight-line, even if a future distance service can use provider APIs.
```

This keeps map behavior consistent with simulation.

### Simulation Layer

Simulation happens in:

```text
backend/src/services/simulationService.js
backend/src/controllers/simulationController.js
backend/src/routes/simulationRoutes.js
```

The route is exposed as:

```http
POST /api/simulation/tick
```

Current simulation behavior:

1. Find active moving orders:

```text
ASSIGNED
PICKED_UP
```

2. For each assigned order, find its rider.
3. Move the rider forward along the current route.
4. Increase `order.progress`.
5. If progress reaches `1` while order is `ASSIGNED`:

```text
order.status = PICKED_UP
rider.status = PICKED_UP
route becomes restaurant -> customer
progress resets to 0
```

6. If progress reaches `1` while order is `PICKED_UP`:

```text
order.status = DELIVERED
rider.status = IDLE
rider.currentOrderId = null
rider.activeOrders decreases
route clears
```

Recommended improvement/implementation detail:

```text
When the rider reaches restaurant, set rider latitude/longitude exactly to restaurant coordinates.
When the rider reaches customer, set rider latitude/longitude exactly to customer coordinates.
```

This avoids tiny coordinate mismatch at lifecycle boundaries.

### Map Snapshot Layer

The current backend already has a map snapshot service:

```text
backend/src/services/mapService.js
backend/src/controllers/mapController.js
backend/src/routes/mapRoutes.js
```

The route is:

```http
GET /api/map/state
```

This endpoint should be the frontend's source of truth when the map first loads or when WebSocket reconnects.

It returns grouped map data:

```text
riders
restaurants
customers
orders
```

This is better than calling separate endpoints like `/riders` and `/orders` from the map page because the map needs a combined snapshot.

### WebSocket Layer

At the time of this document, the backend has REST map state and simulation tick logic, but the final WebSocket broadcasting layer still needs to be implemented or wired.

Recommended responsibility:

```text
REST API gives the full current snapshot.
WebSocket sends only live changes after that.
```

Recommended event types:

```text
map_state_updated
rider_location_updated
rider_status_updated
order_status_updated
order_assigned
order_completed
```

Minimum event needed for smooth live map:

```text
rider_location_updated
```

Example payload:

```json
{
  "event": "rider_location_updated",
  "data": {
    "riderId": "RIDER_ID",
    "lat": 26.8472,
    "lng": 80.9468,
    "status": "ACCEPTED",
    "activeOrderId": "ORDER_ID",
    "timestamp": "2026-06-20T10:00:00.000Z"
  }
}
```

When simulation advances, the backend should either:

- Emit one event per updated rider/order, or
- Emit a compact `map_state_updated` event containing changed objects.

For the current demo, one event per changed rider/order is easier to understand and debug.

### Frontend Map Layer

Frontend map work should be added under `frontend/src`.

Recommended files/components:

```text
frontend/src/features/map/MapplsProvider.jsx
frontend/src/features/map/RiderLiveMap.jsx
frontend/src/features/map/OrderTrackingMap.jsx
frontend/src/features/map/mapStatusStyles.js
frontend/src/features/map/mapUtils.js
frontend/src/features/map/useMapState.js
frontend/src/features/map/useMapSocket.js
```

Suggested responsibilities:

`MapplsProvider.jsx`

- Loads Mappls SDK script.
- Reads `VITE_MAPPLS_TOKEN`.
- Exposes map SDK readiness.

`RiderLiveMap.jsx`

- Shows active riders.
- Colors riders by status.
- Updates rider marker positions on WebSocket events.

`OrderTrackingMap.jsx`

- Shows active/assigned orders.
- Shows rider, restaurant, and customer points.
- Draws straight-line route polylines.
- Shows order/rider InfoWindows.

`mapStatusStyles.js`

- Maps statuses to marker colors and labels.

`mapUtils.js`

- Builds straight polyline coordinates.
- Calculates display distance if needed.
- Normalizes Mappls coordinate shape if needed.

`useMapState.js`

- Fetches `GET /api/map/state`.
- Stores riders/orders/restaurants/customers.
- Provides refresh function for reconnect handling.

`useMapSocket.js`

- Opens WebSocket connection.
- Handles reconnect.
- Applies incoming live updates.
- Triggers fresh snapshot after reconnect.

### Frontend Environment Variables

The frontend should use:

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPPLS_TOKEN=your_mappls_key_here
```

The real `.env` file should not be committed.

If needed, commit:

```text
frontend/.env.example
```

with:

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPPLS_TOKEN=
```

## Required Mappls Features

Use the Mappls Web Map SDK and related active allocations for:

- Default map rendering
- Map load event
- Set map center and zoom
- HTML/custom rider markers
- Multiple markers
- Custom marker popups
- Basic polylines
- Animated marker with polyline reference/example
- Custom InfoWindow or InfoWindow with header

Do not use these in the current version:

- Geocoding
- Reverse geocoding
- Snap to road
- Route ETA
- Traffic route API
- Distance Matrix API
- Traffic overlay
- POI along route
- Navigation SDK
- Marker clustering
- Draggable markers

These may be revisited later if the project changes from simulated tracking to production-like routing/navigation.

## 1. Marker Movement

### Problem

On every WebSocket tick, the backend sends a new rider location:

```json
{
  "riderId": "RIDER_ID",
  "lat": 26.8472,
  "lng": 80.9468,
  "status": "ACCEPTED"
}
```

If the frontend directly sets the marker to the new position, the marker will jump from the old coordinate to the new coordinate. With a 2-3 second tick interval, this looks robotic and visually jarring.

### Decision

Markers should move smoothly between old and new coordinates.

The frontend should animate the marker from the previous location to the new WebSocket location over roughly the same duration as the backend tick interval.

Recommended values:

```text
Backend simulation tick interval: 2 seconds
Frontend marker animation duration: 2 seconds
Movement per simulation tick: 5% progress
```

### Implementation Direction

The frontend should keep marker instances stable. Each rider marker should be stored by `riderId`. When a new location arrives:

1. Find the existing rider marker by `riderId`.
2. Read the old location from frontend state or marker state.
3. Animate from old location to new location.
4. Update the stored location after animation starts/completes.

Do not destroy and recreate the marker on every tick.

### Why This Decision

- It looks more polished in the demo.
- It still matches the simulated movement model.
- It avoids the teleport effect.
- It requires only a small amount of frontend animation logic.

### Final Answer

Markers will be animated between old and new coordinates on every WebSocket tick. They will not be snapped directly to the new coordinate.

### File/Part Interaction For Marker Movement

```text
backend simulation/allocation changes rider latitude/longitude
-> backend emits rider_location_updated over WebSocket
-> frontend useMapSocket receives event
-> frontend updates rider state in useMapState/store
-> RiderLiveMap finds existing rider marker by riderId
-> marker animates from old coordinates to new coordinates
```

Backend files involved:

```text
backend/src/services/simulationService.js
backend/src/utils/geo.js
future WebSocket broadcaster module
```

Frontend files to create/use:

```text
frontend/src/features/map/useMapSocket.js
frontend/src/features/map/useMapState.js
frontend/src/features/map/RiderLiveMap.jsx
frontend/src/features/map/mapUtils.js
```

## 2. Route Line Rendering

### Problem

The project uses straight-line/Haversine-style distance logic for allocation and simulation. The map can either:

- Draw straight-line polylines between coordinates.
- Call a Directions/Route API to draw road-following routes.

Road-following routes look more realistic, but they require extra API calls and introduce extra failure points.

### Decision

Use straight-line polylines for the current version.

The map will not call Directions API, Route ETA API, Snap to Road API, or traffic-aware routing APIs for route drawing.

### Route Display Rules

Before pickup:

```text
Rider current location -> Restaurant
Restaurant -> Customer
```

After pickup:

```text
Rider current location -> Customer
```

After delivery:

```text
No active route line for that order
```

### Why This Decision

- It is consistent with simulated rider movement.
- It is consistent with straight-line distance/scoring logic.
- It costs nothing extra.
- It avoids route API dependency/failure during demo.
- It is easy to explain honestly.

### Future Scope

If the project later needs production-like navigation, this can be upgraded to:

- Road-following route
- Traffic-aware ETA
- Snap-to-road movement
- Route optimization

Future statement:

```text
Current version uses straight-line simulated routing. Traffic-aware road routing can be added later using routing APIs.
```

### Final Answer

Route lines will be straight-line polylines. They will not follow roads in the current version.

### File/Part Interaction For Route Lines

```text
backend/src/services/allocationService.js
-> creates order.route for rider -> restaurant
backend/src/services/simulationService.js
-> changes order.route to restaurant -> customer after pickup
GET /api/map/state
-> exposes order.route, order.progress, rider/customer/restaurant coordinates
OrderTrackingMap
-> draws straight Mappls polyline from these coordinates
```

The frontend should not call route APIs for drawing the line. It should use coordinates already present in the map state response.

## 3. Map API Key Storage And Restriction

### Problem

A frontend map key is public because it is shipped inside the browser JavaScript bundle. Anyone can inspect frontend code and see the key.

This does not mean the key should be hardcoded or committed. It means the key must be managed carefully and restricted where possible.

### Decision

The Mappls key should be stored in a frontend environment variable and never hardcoded in source code.

For Vite frontend:

```env
VITE_MAPPLS_TOKEN=your_mappls_key_here
```

The frontend reads it using:

```js
const mapplsToken = import.meta.env.VITE_MAPPLS_TOKEN;
```

### Git Rules

- Do not commit the real key.
- Keep `.env` local.
- Commit only `.env.example` if needed.
- Do not share the key in WhatsApp, GitHub, screenshots, or public docs.

Example `.env.example`:

```env
VITE_MAPPLS_TOKEN=
```

### Restriction Rules

Once the final deployment domain is decided, restrict/whitelist the key in Mappls dashboard.

Recommended whitelisting:

```text
Development: local setup if Mappls supports it
Production: final Vercel/custom domain
```

If the final domain is not decided yet, leave domain restriction pending and document it as a deployment checklist item.

### Team Access

Team members should be invited to the Mappls application as users instead of sharing the owner's login/password.

Recommended role:

```text
Teammates: Developer
Owner: Admin
```

### Final Answer

The Mappls key will live in the frontend `.env` file, not in committed source code. Once the deployment domain is finalized, the key should be restricted/whitelisted in Mappls.

### File/Part Interaction For API Key

```text
frontend/.env
-> VITE_MAPPLS_TOKEN
-> MapplsProvider.jsx loads Mappls SDK script
-> map components wait until SDK is ready
-> RiderLiveMap and OrderTrackingMap create maps/markers/polylines
```

The backend does not need the frontend Mappls SDK key for rendering maps.

If the backend later uses Mappls REST APIs for distance or route calculations, backend credentials should be kept separately in backend environment variables and must not be exposed to the frontend.

## 4. Geocoding Requirement

### Problem

Geocoding means converting a written address into latitude/longitude. The project has a customer address field, so we need to decide whether that address should be converted into coordinates.

### Current Data Model

The project already stores coordinates directly for:

- Riders
- Restaurants
- Customers

This means the map does not need to convert addresses into coordinates.

### Decision

No geocoding is required for the current map scope.

The customer address field should be treated as display text only.

### When Geocoding Would Be Needed

Geocoding would be needed only if the project adds a flow like:

```text
Admin types customer address
System converts address into latitude/longitude
Order is created from converted coordinates
```

That is not part of the current scope.

### Why This Decision

- Simpler implementation
- Lower cost
- Fewer provider dependencies
- No risk of address conversion errors during demo

### Final Answer

No geocoding is needed now. The map will use stored lat/lng values directly. Address strings are display-only.

### File/Part Interaction For Geocoding Decision

Coordinates should come from existing database fields:

```text
Rider.latitude / Rider.longitude
Restaurant.latitude / Restaurant.longitude
Customer.latitude / Customer.longitude
Order.restaurantLat / Order.restaurantLng
Order.customerLat / Order.customerLng
```

`mapService.js` should continue returning coordinates directly. The frontend should not call Search, Autosuggest, Geocode, or Reverse Geocode APIs for the current map.

## 5. Marker Performance

### Problem

The rider map can show multiple active riders. Every WebSocket tick may update rider positions. If the frontend recreates all markers every tick, it can cause flicker and unnecessary rendering work.

### Expected Scale

For the demo:

```text
Expected riders: around 20
Possible safe range: 20-50
```

This is not a performance issue for Mappls or similar map SDKs.

### Decision

Marker count is safe for the current project. The frontend should update existing marker instances instead of recreating markers on every tick.

### Implementation Rules

Use a stable lookup:

```text
riderId -> marker instance
```

On WebSocket update:

1. Find marker by `riderId`.
2. Update marker position.
3. Update marker color/status only if status changed.
4. Keep other markers untouched.

Avoid:

- Clearing all markers every tick
- Recreating every rider marker every tick
- Re-rendering the full map for one rider update

### When Clustering Is Needed

Marker clustering is not needed now.

Consider clustering only if the project grows to hundreds or thousands of markers.

### Final Answer

20 riders is not a performance issue. The frontend should keep marker instances stable and update marker positions in place.

### File/Part Interaction For Marker Performance

The frontend should keep two separate things:

```text
React state: rider/order data
Mappls marker refs: actual map marker instances
```

Recommended structure:

```text
riderMarkersRef.current = {
  [riderId]: markerInstance
}
```

When rider data changes:

- If marker does not exist, create it.
- If marker exists, update its position/status.
- If rider disappears or becomes irrelevant, remove that marker.

This keeps the Mappls map stable and avoids full marker recreation.

## 6. WebSocket Reconnect Behavior

### Problem

WebSocket connections can disconnect due to:

- Network issues
- Backend restart
- Browser sleep
- Temporary connection drop

If the frontend misses updates while disconnected, the map may show stale rider locations or outdated order statuses.

### Decision

On WebSocket reconnect, the frontend should fetch a fresh map snapshot from the backend.

Use:

```http
GET /api/map/state
```

This is better than waiting for the next WebSocket tick because the snapshot gives the complete current state.

### Recommended Flow

```text
Map page opens
-> Fetch GET /api/map/state
-> Render current riders, restaurants, customers, and active orders
-> Open WebSocket connection
-> Apply live updates from WebSocket events
-> If socket disconnects, show reconnecting state if needed
-> When socket reconnects, fetch GET /api/map/state again
-> Replace stale frontend state with fresh backend state
-> Continue applying WebSocket updates
```

### Snapshot Data Should Include

The map snapshot should include:

- Riders
- Restaurants
- Customers
- Active orders
- Rider coordinates
- Rider status
- Order status
- Assigned rider ID
- Route/progress if available

The current backend already has a map state route/service shape for this purpose.

### Final Answer

When WebSocket reconnects, the frontend will refetch `GET /api/map/state` and replace stale map state before continuing with live updates.

### File/Part Interaction For Reconnect

```text
useMapSocket detects disconnect/reconnect
-> calls refreshMapState from useMapState
-> refreshMapState calls GET /api/map/state
-> frontend replaces local map state
-> map components update marker/polyline refs
-> WebSocket live updates continue
```

Backend endpoint involved:

```text
backend/src/routes/mapRoutes.js
backend/src/controllers/mapController.js
backend/src/services/mapService.js
```

Frontend pieces involved:

```text
frontend/src/api/endpoints.js
frontend/src/api/axios.js
frontend/src/features/map/useMapState.js
frontend/src/features/map/useMapSocket.js
```

`endpoints.js` should include:

```js
export const ENDPOINTS = {
  MAP_STATE: '/map/state',
};
```

## Rider And Order Lifecycle For Maps

### Rider Statuses

Recommended rider statuses for map display:

```text
IDLE
ACCEPTED
PICKED_UP
OFFLINE
```

Meaning:

- `IDLE`: Rider has no active order.
- `ACCEPTED`: Rider is assigned and going to restaurant.
- `PICKED_UP`: Rider picked up food and is going to customer.
- `OFFLINE`: Rider is unavailable.

Recommended marker colors:

```text
IDLE: green
ACCEPTED: orange
PICKED_UP: blue
OFFLINE: gray
```

### Order Statuses

Recommended order statuses:

```text
PENDING
ASSIGNED
PICKED_UP
DELIVERED
CANCELLED
```

Meaning:

- `PENDING`: Order created but not assigned.
- `ASSIGNED`: Rider assigned and moving toward restaurant.
- `PICKED_UP`: Rider picked up order and is moving toward customer.
- `DELIVERED`: Order completed.
- `CANCELLED`: Order cancelled.

### Simulated Movement Rules

The rider movement should be deterministic, not random.

Randomness can be used for initial dummy rider locations, but delivery movement should follow the order lifecycle.

Recommended movement:

```text
ASSIGNED stage: rider moves toward restaurant
PICKED_UP stage: rider moves toward customer
DELIVERED stage: rider becomes IDLE
```

Important rule from mentor:

```text
When the rider reaches the restaurant, set rider location exactly to restaurant coordinates.
When the rider reaches the customer, set rider location exactly to customer coordinates.
```

This avoids small coordinate drift and makes the state transition visually clear.

## Recommended Implementation Order

Implement in this order:

1. Store Mappls key in frontend `.env`.
2. Load Mappls Web Map SDK in frontend.
3. Render default map.
4. Fetch `GET /api/map/state`.
5. Render rider, restaurant, and customer markers.
6. Add marker colors based on rider status.
7. Add straight-line polylines for active orders.
8. Add custom InfoWindows/popups.
9. Add WebSocket connection.
10. Apply WebSocket rider/order updates to existing markers.
11. Add smooth marker movement.
12. Add reconnect handling that refetches `GET /api/map/state`.

## Runtime Flows

### Flow A: Map Page First Load

```text
Admin opens map/dashboard page
-> frontend loads Mappls SDK using VITE_MAPPLS_TOKEN
-> Mappls SDK becomes ready
-> frontend creates map instance
-> frontend calls GET /api/map/state
-> backend mapService reads riders, restaurants, customers, active orders
-> backend returns full map snapshot
-> frontend renders markers and polylines
-> frontend opens WebSocket connection
```

Main files:

```text
frontend/src/features/map/MapplsProvider.jsx
frontend/src/features/map/useMapState.js
frontend/src/features/map/RiderLiveMap.jsx
frontend/src/features/map/OrderTrackingMap.jsx
backend/src/services/mapService.js
backend/src/controllers/mapController.js
backend/src/routes/mapRoutes.js
```

### Flow B: Admin Creates And Allocates Order

```text
Admin creates order
-> order is stored as PENDING
-> admin triggers allocation
-> allocationService finds best IDLE/ONLINE rider
-> order becomes ASSIGNED
-> rider becomes ACCEPTED
-> order.route becomes rider -> restaurant
-> allocation history is saved
-> backend should emit order_assigned/order_status_updated event
-> frontend adds/updates order and rider marker on map
```

Main files:

```text
backend/src/services/orderService.js
backend/src/services/allocationService.js
backend/src/models/Order.js
backend/src/models/Rider.js
backend/src/models/AllocationHistory.js
future WebSocket broadcaster module
```

### Flow C: Simulation Tick Moves Rider

```text
Simulation tick runs
-> simulationService finds ASSIGNED/PICKED_UP orders
-> rider moves along current straight route
-> rider latitude/longitude is saved
-> order progress is saved
-> backend emits rider_location_updated/order_status_updated if needed
-> frontend receives event
-> marker animates to new coordinate
-> route line updates if needed
```

Main files:

```text
backend/src/routes/simulationRoutes.js
backend/src/controllers/simulationController.js
backend/src/services/simulationService.js
backend/src/utils/geo.js
frontend/src/features/map/useMapSocket.js
frontend/src/features/map/RiderLiveMap.jsx
frontend/src/features/map/OrderTrackingMap.jsx
```

### Flow D: Rider Reaches Restaurant

```text
order.status is ASSIGNED and progress reaches 1
-> rider location is set exactly to restaurant coordinates
-> order.status becomes PICKED_UP
-> rider.status becomes PICKED_UP
-> order.route becomes restaurant -> customer
-> order.progress resets to 0
-> backend emits order_status_updated and rider_location_updated
-> frontend changes rider marker color from orange to blue
-> frontend updates route line toward customer
```

### Flow E: Rider Reaches Customer

```text
order.status is PICKED_UP and progress reaches 1
-> rider location is set exactly to customer coordinates
-> order.status becomes DELIVERED
-> rider.status becomes IDLE
-> rider.currentOrderId becomes null
-> rider.activeOrders decreases
-> order.route clears
-> backend emits order_completed and rider_status_updated
-> frontend removes active order route
-> frontend changes rider marker color to green
```

### Flow F: WebSocket Disconnects

```text
Socket disconnects
-> frontend marks socket as reconnecting if UI needs it
-> frontend keeps last visible map state temporarily
-> socket reconnects
-> frontend calls GET /api/map/state
-> frontend replaces stale state with fresh backend snapshot
-> frontend continues applying live events
```

This avoids stale markers after missed events.

## Current Gaps To Implement

Backend pieces that exist:

- Models for riders/orders/restaurants/customers
- Allocation service
- Simulation service
- Haversine/interpolation utility
- Map state endpoint
- Simulation tick endpoint

Backend pieces still needed or to verify:

- WebSocket server setup attached to the HTTP server
- WebSocket event emitter/broadcaster
- Emitting events after allocation
- Emitting events after simulation tick
- Exact socket reconnect protocol

Frontend pieces that exist:

- Axios base instance
- Skeleton App component

Frontend pieces still needed:

- Mappls SDK loader
- Map page/dashboard UI
- Rider live map
- Order tracking map
- Map state hook
- WebSocket hook
- Marker refs and animation logic
- Polyline rendering
- InfoWindow rendering
- `.env.example` for Mappls token

## Final Decisions Summary

| Question | Decision |
| --- | --- |
| Marker movement | Animate smoothly between old and new coordinates |
| Route line | Straight-line polyline, not road-following |
| API key | Store in frontend `.env`; restrict/whitelist after deployment domain is finalized |
| Geocoding | Not needed because lat/lng is already stored |
| Marker performance | 20 riders is safe; update markers in place |
| WebSocket reconnect | Refetch `GET /api/map/state` after reconnect |
| Map provider | Mappls |
| Tracking source | Simulated movement, not real GPS |
| Current audience | Admin/internal dashboard |
