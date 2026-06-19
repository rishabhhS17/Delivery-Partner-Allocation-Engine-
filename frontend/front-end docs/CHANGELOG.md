# Changelog

All notable changes to this project will be documented in this file.

## 2026-06-17

### Added
- Initialized required documentation management files (`PROJECT_STATE.md`, `CHANGELOG.md`, `DEBUG_LOG.md`, `DECISIONS.md`, `HANDOFF.md`, `KNOWN_ISSUES.md`, `FALLBACKS.md`, `PROMPTS.md`).
- Added responsive frontend shell layout including `Sidebar.jsx`, `Topbar.jsx`, and `AppLayout.jsx`.
- Added MUI custom theme config `theme.js` reflecting the primary brand colors (Orange/Red) from `DESIGN.md`.
- Added standard application routing mapping to six placeholder pages (`Dashboard`, `Riders`, `Orders`, `LiveMap`, `AllocationHistory`, `Settings`).
- `frontend/src/config/navigation.js`: Extracted routing configuration from sidebar array.

### Changed
- Overwrote `App.jsx` and `main.jsx` to mount the Material UI `ThemeProvider`, `CssBaseline`, and `BrowserRouter`.
- Refactored `frontend/src/components/navigation/Sidebar.jsx` to dynamically consume navigation configuration instead of a hardcoded internal array.
- Implemented static layout in `frontend/src/pages/Dashboard.jsx` utilizing responsive MUI Grid for KPI cards and side-by-side Map/Activity sections.
- Overwrote `frontend/src/pages/Riders.jsx` placeholder with a structured static table layout and filter controls.
- Overwrote `frontend/src/pages/Orders.jsx` placeholder with a 6-column structured static table layout.
- Overwrote `frontend/src/pages/AllocationHistory.jsx` placeholder with an informational banner and 5-column table layout.
- Overwrote `frontend/src/pages/LiveMap.jsx` placeholder with a map injection block, marker legend, and routing information block.
- Overwrote `frontend/src/pages/Settings.jsx` placeholder with a read-only 4-up card grid detailing system allocation weights.
- Refined `Dashboard.jsx` to decrease map height to 400px, balance the map/list desktop ratio to 7/5, and update the summary list's empty state text.
- Standardized empty state presentation across `Riders.jsx`, `Orders.jsx`, and `AllocationHistory.jsx` with centered spanning table cells.
- Refined `Topbar.jsx` to replace the raw text search placeholder with a disabled visual TextField.
- Refined `Riders.jsx` to visually disable the filter ButtonGroup and add helper text.
- Refined `Orders.jsx` to natively disable the primary Create Order button, preventing false interaction.
- Aligned empty-state typography across all tables to follow a strict textual pattern for improved consistency.
- Refined `LiveMap.jsx` by absorbing the marker legend into the map container header to eliminate scroll-fatigue.
- Re-architected visual hierarchy via global `theme.js` overrides, establishing an off-white canvas depth (`#FAF8F5`), structured layout elevations, constrained specific CSS transitions, and distinct table header styling.

### Fixed
- None
