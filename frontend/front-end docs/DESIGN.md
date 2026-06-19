---
version: alpha
name: Delivery-Partner-Allocation-Engine-Design-System
description: A Swiggy/Zomato-inspired delivery operations platform design system built on a warm charcoal ink, an electric orange primary, and an atmospheric gradient mesh for entry screens. The system pairs the Inter font family at thin (300) weights with negative letter-spacing for clean display headlines, and uses tabular-figure body type where rider and order metrics matter. Buttons are tight-radius pills, cards live on near-white surfaces, and the dashboard surfaces remain predominantly light with warm accents.

colors:

# Primary Brand — Swiggy Inspired

primary: "#FC8019"
primary-deep: "#E46F12"
primary-press: "#C95E0B"
primary-soft: "#FFA94D"
primary-bg-subdued-hover: "#FFF1E3"

# Secondary Brand — Zomato Inspired

secondary: "#EF4F5F"
secondary-soft: "#FFF1F3"

# Text & Neutrals

brand-dark-900: "#2D2A26"

ink: "#2D2A26"
ink-secondary: "#4B463F"
ink-mute: "#6F6A63"
ink-mute-2: "#8A837A"

on-primary: "#FFFFFF"

# Surfaces

canvas: "#FFFFFF"
canvas-soft: "#FFFCF8"
canvas-cream: "#FFF8F1"

# Borders & Inputs

hairline: "#F1E7DA"
hairline-input: "#E7D9C7"

# Semantic States

success: "#22C55E"
warning: "#F59E0B"
error: "#EF4444"
info: "#3B82F6"

# Decorative Accents

ruby: "#EF4F5F"
magenta: "#FF8A98"
lemon: "#FFC36B"

# Shadows

shadow-warm: "rgba(252, 128, 25, 0.08)"
shadow-neutral: "rgba(45, 42, 38, 0.08)"

# Rider Status Colors

rider-available: "#22C55E"
rider-busy: "#F59E0B"
rider-offline: "#9CA3AF"

# Order Status Colors

order-pending: "#FC8019"
order-assigned: "#3B82F6"
order-delivered: "#22C55E"
order-delayed: "#EF4444"

dashboard-principles:
  - "White-first interface"
  - "Warm accent colors used sparingly"
  - "Maps are the primary visualization"
  - "Data density over decoration"
  - "Status colors reserved for riders and orders"
  - "Orange indicates actions, not information"
  - "Operational clarity takes precedence over branding"

semantic-guidelines:
  orange:
    use:
      - "primary actions"
      - "active navigation"
      - "pending orders"
      - "selected filters"
    avoid:
      - "body text"
      - "large backgrounds"
      - "data visualizations"
  green:
    use:
      - "available riders"
      - "completed deliveries"
      - "success messages"
  blue:
    use:
      - "assigned orders"
      - "informational states"
      - "active routes"
  red:
    use:
      - "delayed orders"
      - "errors"
      - "urgent alerts"
  gray:
    use:
      - "offline riders"
      - "disabled states"
      - "inactive controls"

gradient-mesh:
  enabled: true
  usage:
    - login screen
    - onboarding screens
    - empty states
  disabled-on:
    - dashboard
    - riders page
    - orders page
    - allocation page
    - analytics page
  colors:
    - "#FFF8F1"
    - "#FFE8CC"
    - "#FFC36B"
    - "#FC8019"
    - "#EF4F5F"
  notes:
    - Use subtle gradients only
    - Never reduce readability
    - Operational surfaces remain predominantly white

map-principles:
  provider: Mapbox
  style: light
  clustering: true
  markers:
    rider-available: "{colors.rider-available}"
    rider-busy: "{colors.rider-busy}"
    rider-offline: "{colors.rider-offline}"
    order-pending: "{colors.order-pending}"
    order-assigned: "{colors.order-assigned}"
    order-delayed: "{colors.order-delayed}"
    order-delivered: "{colors.order-delivered}"

table-principles:
  row-height: 56px
  sticky-header: true
  hover:
    background: "{colors.canvas-soft}"
  numeric-columns:
    typography: "{typography.body-tabular}"
  zebra-stripes: false

application-layout:
  sidebar-width: 240px
  topbar-height: 64px
  content-padding: 24px
  map-panel:
    desktop: 40%
    tablet: 100%

typography:
  display-xxl:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 56px
    fontWeight: 300
    lineHeight: 1.03
    letterSpacing: -1.4px
    fontFeature: ss01
  display-xl:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 48px
    fontWeight: 300
    lineHeight: 1.15
    letterSpacing: -0.96px
    fontFeature: ss01
  display-lg:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 32px
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: -0.64px
    fontFeature: ss01
  display-md:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 26px
    fontWeight: 300
    lineHeight: 1.12
    letterSpacing: -0.26px
    fontFeature: ss01
  heading-lg:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 22px
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: -0.22px
    fontFeature: ss01
  heading-md:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 20px
    fontWeight: 300
    lineHeight: 1.4
    letterSpacing: -0.2px
    fontFeature: ss01
  heading-sm:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 300
    lineHeight: 1.4
    letterSpacing: 0
    fontFeature: ss01
  body-lg:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 300
    lineHeight: 1.4
    letterSpacing: 0
    fontFeature: ss01
  body-md:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 300
    lineHeight: 1.4
    letterSpacing: 0
    fontFeature: ss01
  body-tabular:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 300
    lineHeight: 1.4
    letterSpacing: -0.42px
    fontFeature: tnum
  button-md:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: 0
    fontFeature: ss01
  button-sm:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: 0
    fontFeature: ss01
  caption:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.39px
    fontFeature: tnum
  micro:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 300
    lineHeight: 1.4
    letterSpacing: 0
    fontFeature: ss01
  micro-cap:
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: 0.1px
    fontFeature: ss01

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  huge: 64px

components:
  button-primary-pill:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 8px 16px
  button-primary-pill-pressed:
    backgroundColor: "{colors.primary-press}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 8px 16px
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 8px 16px
  button-on-dark:
    backgroundColor: "{colors.brand-dark-900}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 8px 16px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
  text-input-focused:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
  card-dashboard-panel:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-tabular}"
    rounded: "{rounded.lg}"
    padding: 24px
  pill-tag-soft:
    backgroundColor: "{colors.primary-bg-subdued-hover}"
    textColor: "{colors.primary-deep}"
    typography: "{typography.micro-cap}"
    rounded: "{rounded.pill}"
    padding: 4px 8px
  sidebar-navigation:
    backgroundColor: "{colors.canvas}"
    borderRight: "1px solid {colors.hairline}"
    textColor: "{colors.ink}"
    activeItem:
      backgroundColor: "{colors.primary-bg-subdued-hover}"
      textColor: "{colors.primary}"
  link-on-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 0px
---

## Overview

The design language of the Delivery Partner Allocation Engine is built on a clean, light interface, utilizing a warm charcoal ink, an electric orange primary, and an atmospheric gradient mesh reserved strictly for login, onboarding, and empty state screens. Dashboard pages prioritize data density, utilizing white surfaces (`{colors.canvas}`) with warm gray accents to display live maps, allocation logs, and real-time metrics. The interface is optimized to give dispatchers and operations managers clear, rapid access to fleet and route information.

The color system has two primary roles. **orange** (`{colors.primary}` — `#FC8019`) is the primary brand color, used intentionally for primary actions, active navigation, and pending orders. **warm charcoal** (`{colors.ink}` — `#2D2A26`) is the universal body text color and the fill of text accents on the light operations dashboard. Zomato Red (`{colors.ruby}`) and coral (`{colors.magenta}`) appear as accent details or alert states in product UI; they are not used as button colors.

Typography is built around **Inter** at weight 300 with negative letter-spacing for clean headings. Display sizes use negative tracking to maintain tight, clear labels; tabular metric sizes (where rider counts, delivery times, distances, ratings, and order volumes matter) use the OpenType `tnum` feature plus a tightening tracking. The `ss01` stylistic set is enabled across all roles to ensure clean letterforms.

**Key Characteristics:**
- Gradient-mesh backdrop used strictly for login, onboarding, and empty states — cream → peach → amber → orange → coral horizontally washed to provide warmth.
- Predominantly light interface: 85% white, 10% warm gray, and 5% orange/red accents.
- Inter thin (weight 300) display tier with negative tracking for editorial precision.
- Tabular-figure body type (`tnum`) for any cell containing rider counts, delivery times, distances, ratings, and order volumes.
- Tight pill-shaped buttons (`{rounded.pill}` 9999px) with `8px 16px` padding for clean, action-oriented items.
- Responsive grids and map-first layouts that prioritize real-time operations over decoration.

## Primary Screens

The platform is designed around the following core interfaces:

- **Dashboard**: Real-time overview of active deliveries, rider utilization, and system warnings.
- **Riders**: Grid/list view of delivery partners, their statuses (Available, Busy, Offline), ratings, and metrics.
- **Orders**: Live tracking of pending, assigned, delayed, and completed orders.
- **Allocation History**: Audit logs of the allocation engine's automated match decisions.
- **Live Map**: Leaflet/Mapbox integration showing real-time GPS locations of riders and orders.
- **Analytics**: Historical performance metrics, demand forecasting, and SLA completion rates.
- **Settings**: Allocation engine parameter tuning (e.g., maximum distance, timeout thresholds).

## Colors

> **Source screens:** /dashboard, /riders, /orders, /analytics

### Brand & Accent

- **Primary Orange** (`{colors.primary}` — `#FC8019`): Primary actions, active navigation, pending orders.
- **Primary Deep** (`{colors.primary-deep}` — `#E46F12`): Hover and pressed states.
- **Primary Press** (`{colors.primary-press}` — `#C95E0B`): Button press state.
- **Primary Soft** (`{colors.primary-soft}` — `#FFA94D`): Chart highlights and subtle UI accents.
- **Primary Subdued** (`{colors.primary-bg-subdued-hover}` — `#FFF1E3`): Tag backgrounds and selected filters.
- **Warm Charcoal** (`{colors.brand-dark-900}` — `#2D2A26`): Text emphasis and occasional dark surfaces.
- **Zomato Red** (`{colors.ruby}` — `#EF4F5F`): Delayed orders and urgent alerts.
- **Coral** (`{colors.magenta}` — `#FF8A98`): Decorative accents.
- **Amber** (`{colors.lemon}` — `#FFC36B`): Gradient highlights.

### Surface
- **Canvas** (`{colors.canvas}` — `#FFFFFF`): Default page background.
- **Canvas Soft** (`{colors.canvas-soft}` — `#FFFCF8`): Warm-tinted off-white used on dashboard cards and sections.
- **Canvas Cream** (`{colors.canvas-cream}` — `#FFF8F1`): Warm cream used for subtle backgrounds and highlighted areas.
- **Hairline** (`{colors.hairline}` — `#F1E7DA`): 1px borders on cards and tables.
- **Hairline Input** (`{colors.hairline-input}` — `#E7D9C7`): Slightly warmer hairline used on form inputs.

### Text
- **Ink** (`{colors.ink}` — `#2D2A26`): Default body text color across the platform — warm charcoal, never pure black.
- **Ink Secondary** (`{colors.ink-secondary}` — `#4B463F`): Secondary text on light surfaces.
- **Ink Mute** (`{colors.ink-mute}` — `#6F6A63`): Helper text, captions, table labels.
- **Ink Mute 2** (`{colors.ink-mute-2}` — `#8A837A`): Near-equivalent to ink-mute used in nav.
- **On Primary** (`{colors.on-primary}` — `#FFFFFF`): Text on orange / dark-gray surfaces.

### Semantic
The platform uses a dedicated semantic color palette for system feedback, map pins, and rider/order states (e.g., rider-available, rider-busy, order-delayed).

## Typography

### Font Family

The display and UI tier is **Inter** (`'Inter', 'SF Pro Display', system-ui, sans-serif`) at weights 300 (thin) and 400 (regular). The font is loaded with `font-feature-settings: "ss01"` enabled globally — the stylistic set substitutes a single-story `a` and other character variants that are part of the platform's typographic signature.

When Inter is unavailable, fall back to **SF Pro Display** at thin weights, then system-ui.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xxl}` | 56px | 300 | 1.03 | -1.4px | Dashboard header title |
| `{typography.display-xl}` | 48px | 300 | 1.15 | -0.96px | Section opener |
| `{typography.display-lg}` | 32px | 300 | 1.1 | -0.64px | Card title / sub-section |
| `{typography.display-md}` | 26px | 300 | 1.12 | -0.26px | Compact card title |
| `{typography.heading-lg}` | 22px | 300 | 1.1 | -0.22px | KPI metric label |
| `{typography.heading-md}` | 20px | 300 | 1.4 | -0.2px | Section sub-heading |
| `{typography.heading-sm}` | 18px | 300 | 1.4 | 0 | Mini-section label |
| `{typography.body-lg}` | 16px | 300 | 1.4 | 0 | Section body lead |
| `{typography.body-md}` | 15px | 300 | 1.4 | 0 | Default UI body |
| `{typography.body-tabular}` | 14px | 300 | 1.4 | -0.42px | rider counts, delivery times, distances, ratings, and order volumes (uses `tnum`) |
| `{typography.button-md}` | 16px | 400 | 1.0 | 0 | Pill button label |
| `{typography.button-sm}` | 14px | 400 | 1.0 | 0 | Compact pill label |
| `{typography.caption}` | 13px | 400 | 1.4 | -0.39px | Helper, table labels |
| `{typography.micro}` | 11px | 300 | 1.4 | 0 | Fine print |
| `{typography.micro-cap}` | 10px | 400 | 1.15 | 0.1px | All-caps eyebrow |

### Principles
- **Thin weight is the platform signature.** Display tiers always render at weight 300. Bumping to 400+ removes the platform's editorial air.
- **Negative tracking on display.** -1.4px at 56px, scaling proportionally down to -0.2px at 20px. The negative tracking is the platform's typographic signature.
- **Tabular figures for rider and order metrics.** Any cell rendering rider counts, delivery times, distances, ratings, and order volumes uses `font-feature-settings: "tnum"` plus a tightening tracking. The platform presents data clearly through this micro-detail.
- **`ss01` globally.** Apply `font-feature-settings: "ss01"` to the body element so the stylistic-set substitution is on for every text role.

### Note on Font Substitutes
Inter is the primary font. If needed, fall back to SF Pro Display or system-ui defaults. Inter's rhythmic display at weight 300 with negative letter-spacing and stylistic ss01 features matches the system's character cleanly.

## Layout

### Spacing System
- **Base unit**: 8px (with 2 / 4 / 12 sub-tokens for fine work).
- **Tokens**: `{spacing.xxs}` 2px · `{spacing.xs}` 4px · `{spacing.sm}` 8px · `{spacing.md}` 12px · `{spacing.lg}` 16px · `{spacing.xl}` 24px · `{spacing.xxl}` 32px · `{spacing.huge}` 64px.
- **Section padding**: 24–48px on dashboard screens to maximize space utilization.
- **Card internal padding**: 16–24px on operational metric cards.

### Grid & Container
- Dashboard layout uses a full-width responsive dashboard layout with a collapsible sidebar.
- KPI metrics grid collapses 4-up → 2-up → 1-up at 1024 / 768 breakpoints.
- Map views and list views split 50/50 or 60/40 on desktop, stacking vertically on tablet and mobile.

### Whitespace Philosophy
Whitespace is minimized to optimize information density. Surfaces utilize high contrast and light borders to divide space, ensuring dispatchers can scan metrics without scrolling unnecessarily.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 | Flat | Default surface |
| 1 | `box-shadow: rgba(45, 42, 38, 0.08) 0 1px 3px` | Card lift on white |
| 2 | `box-shadow: rgba(45, 42, 38, 0.08) 0 8px 24px, rgba(45, 42, 38, 0.04) 0 2px 6px` | Active popovers, modal dialogues |
| 3 | Gradient mesh backdrop | Gradient mesh backdrop (strictly on login/onboarding) |

### Decorative Depth
The gradient mesh provides background depth on entry screens. On operational dashboard screens, depth is purely flat or uses Level 1/2 shadows to separate cards, overlays, and tables.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Hairline tags, table chrome |
| `{rounded.sm}` | 6px | Form inputs |
| `{rounded.md}` | 8px | Compact cards, alerts |
| `{rounded.lg}` | 12px | Metric cards, map containers |
| `{rounded.xl}` | 16px | Modal containers |
| `{rounded.pill}` | 9999px | All buttons, tag pills |

### Photography Geometry
The platform does not use photography. Interfaces consist purely of SVG map routes, data tables, and charting components.

## Components

### Buttons

**`button-primary-pill`** — the dominant CTA system-wide.
- Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button-md}`, padding `{spacing.sm} {spacing.lg}` (8px 16px), rounded `{rounded.pill}` 9999px. Used for main action triggers (e.g. 'Trigger Allocation Batch').
- Pressed state `button-primary-pill-pressed` shifts background to `{colors.primary-press}`.

**`button-secondary`** — outline-style alternative.
- Background `{colors.canvas}`, text `{colors.primary}`, 1px solid `{colors.primary}` border, same pill geometry. Used for secondary commands.

**`button-on-dark`** — used on dark UI maps or headers.
- Background `{colors.brand-dark-900}`, text `{colors.on-primary}`, same pill geometry.

### Cards & Containers

**`card-dashboard-panel`** — standard container for dashboard widgets.
- Background `{colors.canvas}`, type `{typography.body-tabular}` (with `tnum` for metrics), padding `{spacing.lg}` 16px, rounded `{rounded.lg}` 12px, Level 1 shadow.

### Inputs & Forms

**`text-input`** — standard form field.
- Background `{colors.canvas}`, text `{colors.ink}`, type `{typography.body-md}`, padding `{spacing.sm} {spacing.md}` (8px 12px), rounded `{rounded.sm}` 6px, 1px `{colors.hairline-input}` border.
- Focus state `text-input-focused`: border swaps to `{colors.primary}`.

### Navigation

**`sidebar-navigation`** — main side panel.
- Background `{colors.canvas}`, borderRight `1px solid {colors.hairline}`, text `{colors.ink}`.

**`sidebar-navigation-activeItem`**
- Background `{colors.primary-bg-subdued-hover}`, text `{colors.primary}`.

### Pills, Tags, and Chips

**`pill-tag-soft`** — subdued orange tag.
- Background `{colors.primary-bg-subdued-hover}`, text `{colors.primary-deep}`, type `{typography.micro-cap}`, padding `4px 8px`, rounded `{rounded.pill}`.

### Signature Components

**Gradient Mesh Backdrop** — cream → peach → amber → orange → coral stops blurred horizontally across the entry screen background.

**Tabular-Figure Metrics Type** — every number rendering rider counts, delivery times, distances, ratings, and order volumes uses `font-feature-settings: 'tnum'`.

**`link-on-light`** — inline links.
- Text `{colors.primary}` rendered in `{typography.body-md}`, no underline by default.

## Do's and Don'ts

### Do

- Reserve orange for actions and active states.
- Use semantic colors consistently across maps, tables, and cards.
- Keep operational pages predominantly white.
- Use tabular figures for rider and order metrics.
- Prioritize readability over decoration.

### Don't

- Don't use orange for body text.
- Don't use gradients on dashboard screens.
- Don't color entire pages orange.
- Don't introduce additional accent colors.
- Don't overload KPI cards with decorative elements.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Wide | ≥ 1440px | Full map and panel layouts optimized for dual-monitor control centers |
| Desktop | 1024–1440px | Default content max-width; KPI metrics grid 4-up |
| Tablet | 768–1023px | KPI metrics grid 2-up; map panels stack vertically |
| Mobile | < 768px | KPI metrics grid 1-up; hamburger nav; display drops 56 → 36px |

### Touch Targets
- Pill buttons hit ≥ 40×40px on mobile via padding scaling. On smaller screens, buttons size up to 44×44px to maintain WCAG AAA.
- Form fields stay at 40px minimum height.

### Collapsing Strategy
- Display tiers stair-step 56 → 48 → 32 → 26 → 22px through the breakpoints.
- Gradient mesh re-tiles on mobile to preserve the wash without disappearing.
- Map components and detailed tables stack vertically; detailed allocation graphs are simplified on mobile.
- Metric grids stair-step.

### Image Behavior
Maps and dashboards use dynamic resize-handling.

## Iteration Guide

1. Focus on ONE component at a time.
2. Reference component names and tokens directly (`{colors.primary}`, `{button-primary-pill}-pressed`, `{rounded.pill}`).
3. Run `npx @google/design.md lint DESIGN.md` after edits.
4. Add new variants as separate entries.
5. Default body to `{typography.body-md}` (15px); use `{typography.body-tabular}` for any rider and order metrics / numeric cell.
6. Apply `ss01` globally on the body; apply `tnum` per-element on numeric content.
7. The gradient mesh is non-negotiable on login/onboarding pages; operational dashboard views remain clean.
