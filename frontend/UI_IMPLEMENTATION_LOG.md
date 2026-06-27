# Frontend UI/Brand Implementation Log

Record of the full visual/brand overhaul performed on `frontend/`. Scope held constant across every round: **zero changes to `backend/`, API calls, routing logic, auth flow, or the allocation engine** — every step below is a design token, a CSS change, a new presentational component, or a static asset. Verified at every round via `git status -- backend` (always clean) and `npm run build`.

---

## Round 1 — Design system foundation + bug fixes

**Tokens & theme** (`src/theme/tokens.css`, `theme.js`)
- Added shadow tiers (`--shadow-sm/md/lg`), motion tokens (`--ease-out`, `--duration-fast/base`), a display font (`--font-display: Space Grotesk`), upgraded `--font-mono` to JetBrains Mono, added `--surface-raised`, a global `:focus-visible` outline, and a `prefers-reduced-motion` kill-switch.
- New dependencies: `lucide-react`, `@fontsource/space-grotesk`, `@fontsource/jetbrains-mono`.
- `theme.js`: heading font-family wired to the display font; `MuiButton` got hover/active scale transforms and per-size heights; `MuiDialog` switched to a `Grow` (fade+scale) transition; `MuiTextField` got a focus glow; `MuiTableRow` got a hover background.

**New shared components** (`src/components/common/`)
- `Spinner`, `Skeleton`/`SkeletonRow(s)`, `LiveDot` (the recurring "live data" pulse motif), `Toast` + `ToastProvider`/`useToast` (top-right, slide-in, 4s auto-dismiss).
- `EmptyState` extended with optional `icon`/`action` props.

**Icons & feedback states**
- Replaced every emoji (☰ 🔍 ☀️/🌙 ✕ ★) with `lucide-react` icons across `Topbar`, `Sidebar` (icon added per nav item in `config/navigation.js`), delete buttons, and `AllocationHistory`.
- `Riders`/`Restaurants`/`Customers`/`Orders`/`AllocationHistory`: split the old single "loading-or-empty" branch into three explicit states (skeleton rows / retry-able error / icon+CTA empty state); added toasts on create/delete; added spinners to submit buttons.
- `AppLayout`: 200ms fade-in on route change.

**Bugs found and fixed (pre-existing, not introduced by this work)**
- `Topbar`'s `AppBar` had no `color` prop, so MUI defaulted it to `color="primary"`, painting it solid black instead of white — fixed via `color="inherit"` plus a proper `MuiAppBar` theme override (a plain CSS-module rule was losing a cascade tie against MUI's own base rule).
- The mobile hamburger button never hid itself at desktop widths, same root cause — fixed by bumping CSS specificity (`button.menuButton`).

---

## Round 2 — Premium semantic color system

- `tokens.css`: added a full semantic alias layer (`--color-primary/secondary/accent/success/warning/danger/info/surface/background/border/text-*/hover/active/focus/overlay/card/sidebar/nav`), warmed the light-mode neutrals (canvas/hairline shifted from stark gray to soft off-white), added true **emerald** success and **cyan** info colors (replacing a reused blue and a flat red respectively), and a `--shadow-modal` tier + `--overlay` token for backdrops.
- `theme.js`: palette updated to match; `MuiBackdrop`/`MuiDrawer` got matching transitions; hardcoded hex literals scattered through component overrides were synced to the new warm tokens.
- `StatusBadge`: "Delivered" remapped from blue to emerald — a real semantic correction, not just decoration.

---

## Round 3 — Dashboard hero, premium tables, micro-interactions

- New components: `CountUp` (animates numbers from 0, reduced-motion aware), `ProgressRing` (SVG ring with animated arc).
- `Dashboard.jsx` rebuilt as a hero band: animated SVG route-line background (3 paths with traveling dots via `<animateMotion>`), stat row reorganized into 3 `StatCard`s + 1 `ProgressRing` (Available/Total riders), and a flash-in highlight on new "Recent allocations" feed entries.
- `StatCard` wired to `CountUp`.
- Tables, site-wide via `theme.js` (one change, applies everywhere): 20px rounded containers, sticky translucent/blurred header, row hover lift, more generous row padding.
- `StatusBadge`: added a per-status icon (clock/navigation/package/check/x/circle-off) next to the existing color dot.

---

## Round 4 — NexRoute brand identity

Brainstormed with the user (name, then logo concept) before touching code, since a wrong guess here would mean redoing work across every page.

- **Name**: NexRoute. **Mark**: a comet stroke sweeping into a destination dot, brand color = the existing accent blue (no new hue introduced).
- New `Logo` component (mark + wordmark, subtle draw/pulse/glow loop, reduced-motion safe).
- New `SplashScreen` — replaces what used to be a blank screen in `ProtectedRoute` while the auth check resolves; cycles through 4 loading phrases.
- New `NotFound` (404) page + catch-all route in `AppRoutes.jsx`.
- 4 branded empty-state illustrations (riders/orders/restaurants/customers); `EmptyState` falls back to the muted brand mark when no icon/illustration is given (covers every error-state empty state for free).
- `Sidebar`: text wordmark replaced with `Logo`; built a sliding "floating pill" active-page indicator (one shared element, position driven by a `data-active-index` attribute + per-index CSS rules — no inline styles); icon hover nudge.
- `Dashboard` hero: added tagline + a slow ambient glow layer behind the route lines.
- `Login`: title replaced with `Logo` + tagline.
- Full browser/PWA branding: `favicon.svg` (embeds a `prefers-color-scheme` swap), `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `og-image.png`, `site.webmanifest`, and matching `<link>`/`<meta>` tags in `index.html`.
  - *Implementation note*: these PNGs were ultimately generated with .NET GDI+ (`PowerShell` + `System.Drawing`) rather than browser screenshots — the screenshot approach kept producing gray-bled crops under this environment's real device-pixel-ratio, confirmed by reading raw pixel values before switching approach.
- **Scope check**: the user proposed a much larger feature list afterward (command palette, FAB, notification center, AI insights panel, etc.). Talked through it explicitly — flagged that a fabricated "AI insights" panel would undercut the brand's own "trustworthy" personality, and the user opted to skip it and add no extra features this round.

---

## Round 5 — Typography & hover refinements

- Page headings (h1/h2/h3) bumped to Space Grotesk weight 700 (was 600); standalone metric numbers (`StatCard`, allocation scores) bumped to mono weight 600, with the actual font file imported so it's a true weight, not faux-bold.
- `PageHeader` titles and the Dashboard hero headline got a hover treatment: color shifts to the accent, an animated gradient underline grows in, letter-spacing loosens slightly, heading lifts 1px.
- Buttons: primary stays brand-ink at rest, blooms into a blue→cyan gradient with a deeper shadow on hover; outlined/text buttons now tint to the accent blue on hover instead of generic gray — one accent color for every hover state, site-wide.
- The one real text link in the app (rider-map popup's order link) switched from an unrelated orange to the brand blue, with a proper animated underline.

---

## Round 6 — Cleanup

- Removed the "OPS — ..." eyebrow line everywhere it appeared (`PageHeader` component, Dashboard hero, Login) plus the now-dead CSS behind it.
- Removed the non-functional, permanently-`disabled` "Search platform…" input from the topbar entirely.

---

## Verification performed at every round

1. `npm run build` (production build) — confirmed clean each round.
2. Visual check in both light and dark mode via Playwright, including a pass at desktop and mobile widths.
3. `git status -- backend` confirmed empty every time.
4. Spot-checked `prefers-reduced-motion` coverage (global rule in `tokens.css` disables all CSS `animation`/`transition`, which is what every new animation in this log uses — nothing relies on JS-driven or SMIL motion that would bypass it, except the Logo's SVG `<animateMotion>` paths, which are hidden outright under reduced motion via CSS).
