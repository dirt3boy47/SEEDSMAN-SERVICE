# Seedsman Quote

Quoting, estimating and job management for Seedsman's Hedges (Mornington Peninsula) — a companion to
[GeoCanvas](https://geo-canvas.dirt3boy47.workers.dev/) that shares its design system: the same eucalyptus-green
accent, frosted floating panels, 16 px corners, toolbar buttons, segmented controls, measure panel, and automatic
light/dark themes.

Live at `https://seedsmans.dirt3boy47.workers.dev` (Cloudflare Worker `seedsmans`, deployed on every push to `main`).
Staff sign in at `/login.html`; the app is at `/app/`.

## Workflow

1. **New quote** — choose an existing customer or type a new one. The property address suggests matches as you type;
   picking one fills the suburb, drops the house pin, flies the map there and works out the return travel from your
   **home base** (Settings) by road (OSRM; straight line × 1.35 if it doesn't answer).
2. **Add service** — pick from the catalogue (hedge trimming, lawn mowing, weeding, mulch, edging, pruning, stump grinding,
   labour…). Services measured on the map open the GeoCanvas measure tool straight away: **Line**, **Area** or **Point**,
   tap or **Freehand** trace for curves, drag points, undo. Services priced **each** (pruning, stump grinding, trees) open in
   **Points** mode: tap every tree — each tap adds a numbered point instantly and the count becomes the quantity. The measured length/area goes into the quantity.
   **Saved drawing** reuses a drawing already on the property.
3. Each service card expands to show quantities (hedges: length, height, depth, condition and the faces to cut — Top, Front,
   Back, LHS, RHS), the cost build-up (labour hours × labour cost, materials, equipment) and the price; any price can be overridden.
4. **Job** — green waste removal, travel, setup hours and a markup override. The **Summary** shows itemised prices, job items
   (setup, cherry picker, disposal, equipment, travel), contingency, minimum, GST and total, plus cost, gross profit, margin and
   hours (for staff only).
5. **Save** (each save is a revision), set the status from the pill next to the quote number, open the **Document**
   (customer-facing quotation with site map): **Download PDF**, **Customer link**, or **Email with PDF** — the device's
   share sheet with the PDF attached (iPad, iPhone, Android, Windows), otherwise the PDF downloads and the email opens.
   The email includes the customer's link (`/quote.html#…`, signed so it can't be guessed) where they can view, download
   and **accept** the quote; accepted quotes go straight to the schedule's To schedule tray.
6. **Schedule** — accepted quotes wait in the **To schedule** tray with their estimated man-hours. Drag one onto a day
   and time (mouse, finger on the grip, or Pencil); job time = man-hours ÷ men. A crew's jobs on the same day are spaced
   by the driving time between the properties (straight line × road factor at an average speed, plus parking time —
   set under the ⚙ on the Schedule page), shown as orange drive blocks. Jobs placed straight after another stay attached
   and move with it. Tap a job to add or remove men (its length and the jobs after it update), change man-hours, crew,
   time, status or notes, get directions, or unschedule it. **Route** on a day shows the stops on a map in order.
   **Big jobs** longer than a working day are booked over several days automatically: day 1 runs to the end of the day,
   the rest goes onto the crew's next working days (set under ⚙; weekends off by default), fitted around other jobs.
   Each day shows "Day 2/3". Moving day 1 moves the whole job; moving a later day moves just that day; more men or fewer
   man-hours re-spread the days still to do; **Add another day** extends it. Unscheduling removes every day still to do.
   Drag any day onto the **To schedule** tray (or use **Send day back** in the job window) to take it off the calendar; it
   waits there with its man-hours until it is dragged onto a day again.
   **Crew per day**: in a day's job window, change the men for *just that day* (it gets more or less done; the days after
   keep their crew and re-spread) or for *that day and after*. Each day keeps its own crew when the job is re-spread.
   **Day / Week / Month** views, with − / + zoom on the day and week views. Each day shows its total value, man-hours and
   jobs along the bottom (a job split over days shares its price by man-hours). In Month, drag a job onto another day or
   tap a date to open that day.

7. **Close out** each job from its **job page** (Schedule › tap the job, or Overview › To close out) — a full-screen,
   one-question-at-a-time flow built for the phone: start and finish times, people, breaks, then how long each kind of
   work took (all the hedging together, then lawns, garden, trees, other, setup), access, slow-downs, green waste,
   **photos**, notes and the **next trim**. Each close-out adds rows to the man-hours database.
   On a **multi-day job**, each day except the last gets a short **end-of-day check-in**: times, people, breaks, then how far
   through each part of the job you are (Not yet / Started / Half / Most / Done for each hedge, lawn…, carried over from the
   day before). That gives the % done (weighted by the quote's estimates) and the man-hours the rest needs at the pace so
   far; one tap re-books the remaining days to fit (more days if behind, fewer if ahead). The job page shows each part's
   progress. The close-out on
   the last day (or on any day, by answering "Yes — it's all finished") adds up every day and cancels days no longer needed.
8. **Trims due** on the Overview (within 30 days): **Book same price** (an accepted quote at last time's price, straight
   to the schedule tray), **Re-quote** (saved measurements at today's rates), +1 month, or remove.
   **Reports › Man-hours** compares actual with estimated man-hours by task and hedge height band; after 3 jobs it suggests
   a corrected rate and applies it to the rate card in one tap.

**Pipeline** (CRM): every enquiry is a card on a board — New enquiry › Contacted › Site visit › Quoted › Won › Scheduled
› Done (and Lost). Drag cards between stages (mouse, or press and hold on a phone/iPad), or use **Move to** on the card.
Cards move forward by themselves when a quote is saved for the enquiry's property, the quote is accepted, the job is booked
and the job is closed out; every quote also gets a card. Dragging to **Won** offers to accept the quote, to **Scheduled**
opens the schedule, to **Quoted** starts the quote (customer and property are set up from the enquiry, matched by phone or
email), to **Lost** asks why. A card's sheet has Call / Text / Email / Directions (logged; calling a new enquiry moves it to
Contacted), the next step, follow-up date, details and history. Follow-ups due show on the Overview.
**Public website** (`/`, files in `public/index.html` and `public/site/`): what customers see — services, how it works,
why us, areas, FAQ and a free-quote form (address suggestions, up to 3 photos, preferred contact and time). Sending it
creates a **New enquiry** in the Pipeline with a follow-up for today, so the CRM process starts straight away; photos show
in the card. Phone, email, ABN and the business name come from Settings › Business details. The staff app is at `/app/`
(Staff login in the footer). Spam-protected (hidden field, 5 enquiries per hour per connection).

Other pages: **Overview** (open quotes, won this month, win rate, jobs this week, follow-ups), **Customers**,
**Properties** (job locations with their site drawings, quotes and jobs), **Map** (the full-screen GIS workspace: every job
location, draw and save site drawings), **Services & pricing** (the rate card), **Reports** (quoted vs won by month, by service,
by suburb), **Settings** (business details and document terms, staff logins, appearance, password).

## Drive times

Road routing runs on the server (`/api/route`): **OSRM** (open source, OpenStreetMap roads) by default, with a range for
typical traffic (wider in weekday peaks, 7–9:30am and 3:30–6:30pm); responses are cached. Add a **Google Maps API key**
(**Routes API**; the older Distance Matrix API is used if the project still has it) in **Settings › Drive times** for
Google's traffic predictions at each departure time, with an optimistic–pessimistic range; the key never leaves the server.
Google supplies the times only — route lines on the map stay OpenStreetMap (Google's terms don't allow its routes on other maps). If neither answers, a straight-line estimate is used.
The schedule spaces jobs by these times (+ parking minutes), and **Route** shows the road route, the drive from and back
to the home base, and each leg's range. The calendar shows each crew's drive from base before its first job ("Leave 6:15am") and back after its last ("Back 11:30am"); the day heading shows the earliest leave time (orange if before the working day). Quote travel uses the same router.

## Map imagery

**Settings › Map imagery**: add a **Nearmap** API key (Tile API v3, zoom 21) or a **MetroMap** key and layer (XYZ, zoom 22)
for the most detailed, most recent aerial photos, or a **Google** key with the **Map Tiles API** for Google satellite
(with roads and labels, Google logo and imagery credits shown as Google requires; restrict that key to this website);
maps then open with it. Free options: Esri satellite and Esri
Clarity (sharper, often newer). **Vicmap aerial** (`AERIAL_WM_256`, WMTS) is listed for organisations with Vicmap
access — the old free `AERIAL_WM` service was retired. Any imagery that fails to load falls back to Esri satellite.
Keys go only to signed-in staff (never to the customer quote page); restrict them to this site in the provider's account.

## Pricing (`public/app/js/pricing.js`, used by the browser and the Worker)

Everything is excluding GST until the end.

- **Cost** of each service item = labour hours × labour cost ($48/h) + materials + equipment.
  - Hedges: face m² (Front/Back = L × H, Top = L × D × 1.2 for time, ends = D × H) ÷ the height tier's m²/person-hour
    (45 / 35 / 25 / 16 / 11 up to 1.2 / 2 / 3 / 4.5 / 8 m) × condition (maintained ×1, overgrown ×1.5, hard cut ×2.5).
    Green waste = face m² × cut-back depth (per hedge; defaults 5 / 15 / 40 cm by condition) × 0.6 loose-volume factor.
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
`jobs` (+ `men`, `man_hours`, `travel_minutes`, `sequence`, migration 0006), `job_closeouts` and `task_times` (the
man-hours database) and `recurring_service_plans` (trims; migration 0007), `photos` (files in R2 bucket `seedsmans-private`), `rate_library`, `business_settings`, `user`/`account`/`session`, `request_limits`, `audit_log`.
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
# …and each later migration in order (0006 – 0011)
npx wrangler dev
```
