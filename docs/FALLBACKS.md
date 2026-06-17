# Fallbacks

Track demo risks and contingency plans.

## Risk: Mapbox unavailable
## Trigger: API limit reached, network failure, or token misconfiguration.
## Fallback: Render static list or grid of riders/orders.
## Recovery Plan: Display warning message to the user that live map tracking is temporarily unavailable.

## Risk: Backend unavailable
## Trigger: Node/Express server crash or hosting outage.
## Fallback: Display global error state with generic "System maintenance" or retry messaging.
## Recovery Plan: Client-side retry logic and monitoring dashboard alerts.

## Risk: Gemini timeout
## Trigger: API timeout during the AI explanation step.
## Fallback: Display default deterministic explanation generated directly by the backend algorithm.
## Recovery Plan: Silently failover to static text generation without throwing a full request error.

## Risk: MongoDB Atlas connection failure
## Trigger: DB cluster scale limits or networking restriction.
## Fallback: Fail fast with clear 503 Service Unavailable HTTP error.
## Recovery Plan: Use automated reconnect logic in mongoose.
