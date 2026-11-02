# Seedsman Quote

Quoting, estimating and job management for Seedsman's Hedges (Mornington Peninsula) — a companion to
[GeoCanvas](https://geo-canvas.dirt3boy47.workers.dev/) that shares its design system: the same eucalyptus-green
accent, frosted floating panels, 16 px corners, toolbar buttons, segmented controls, measure panel, and automatic
light/dark themes.

Live at `https://seedsmans.dirt3boy47.workers.dev` (Cloudflare Worker `seedsmans`, deployed on every push to `main`).
Staff sign in at `/login.html`; the app is at `/app/`.

## Workflow

1. **New quote** — choose an existing customer or type a new one; search the address on the map to drop the house pin.
2. **Add service** — pick from the catalogue (hedge trimming, lawn mowing, weeding, mulch, edging, pruning, stump grinding,
   labour…). Services measured on the map open the GeoCanvas measure tool straight away: **Line**, **Area** or **Point**,
   tap or **Freehand** trace for curves, drag points, undo. The measured length/area goes into the quantity.
   **Saved drawing** reuses a drawing already on the property.
3. Each service card expands to show quantities (hedges: length, height, depth, condition and the faces to cut — Top, Front,
   Back, LHS, RHS), the cost build-up (labour hours × labour cost, materials, equipment) and the price; any price can be overridden.
4. **Job** — green waste removal, travel, setup hours and a markup override. The **Summary** shows itemised prices, job items
   (setup, cherry picker, disposal, equipment, travel), contingency, minimum, GST and total, plus cost, gross profit, margin and
   hours (for staff only).
5. **Save** (each save is a revision), set the status from the pill next to the quote number, open the **Document**
   (customer-facing quotation with site map) and **Save PDF / Print** or **Email**.
6. **Schedule** accepted quotes onto the week with a crew; jobs move through Scheduled → In progress → Completed.

Other pages: **Overview** (open quotes, won this month, win rate, jobs this week, follow-ups), **Customers**,
**Properties** (job locations with their site drawings, quotes and jobs), **Map** (the full-screen GIS workspace: every job
location, draw and save site drawings), **Services & pricing** (the rate card), **Reports** (quoted vs won by month, by service,
by suburb), **Settings** (business details and document terms, staff logins, appearance, password).

## Pricing (`public/app/js/pricing.js`, used by the browser and the Worker)

Everything is excluding GST until the end.

- **Cost** of each service item = labour hours × labour cost ($48/h) + materials + equipment.
  - Hedges: face m² (Front/Back = L × H, Top = L × D × 1.2 for time, ends = D × H) ÷ the height tier's m²/person-hour
    (45 / 35 / 25 / 16 / 11 up to 1.2 / 2 / 3 / 4.5 / 8 m) × condition (maintained ×1, overgrown ×1.5, hard cut ×2.5).
  - Area and length services: quantity ÷ productivity; each: hours per item; hours: as entered; plus materials and equipment.
- **Job costs**: setup (0.5 crew-hours), loading green waste, cherry picker when any hedge is over 3 m ($320 half day /
  $480 day + $150 delivery), disposal ($65/m³), $25 equipment, travel ($1.20/km).
- **Price** = cost × (1 + markup, 35% ⇒ 26% gross margin); then 5% contingency, $180 minimum, GST 10%.
- The customer document lists each service plus cherry picker, waste and travel; setup, equipment, contingency and any
  minimum top-up are spread across the lines.

All figures are editable on **Services & pricing**; saving makes a new rate card version (quotes keep the version they used).

## Data

Cloudflare D1 database `seedsmans`: `customers`, `properties` (+ `lat`/`lng`, migration 0004), `site_drawings`
(migration 0005: lines, areas and points per property, with measurements), `quotes` (+ append-only `quote_revisions`),
`jobs`, `rate_library`, `business_settings`, `user`/`account`/`session`, `request_limits`, `audit_log`.
`schema/existing.sql` is a copy of the tables that were there before this app. Migrations are applied by hand
(`wrangler d1 execute seedsmans --remote --file migrations/000N_….sql`).

Passwords are salted PBKDF2 hashes and sessions are stored as token hashes; 10 wrong sign-ins lock a connection out for
10 minutes. The Worker recalculates every saved quote with the active rate card.

## Files

- `worker/index.js` — API (`/api/…`) and static files
- `public/app/` — the app: `index.html`, `css/app.css` (design system), `js/core.js` (shell, router, components),
  `js/gis.js` (map + GeoCanvas measure tool), `js/pricing.js`, `js/geo.js`, `js/views-*.js` (pages)
- `public/login.html`, `public/_redirects` (old page addresses → the app)

## Local testing

```bash
npx wrangler d1 execute seedsmans --local --file schema/existing.sql
npx wrangler d1 execute seedsmans --local --file migrations/0004_property_location.sql
npx wrangler d1 execute seedsmans --local --file migrations/0005_site_drawings.sql
npx wrangler dev
```
