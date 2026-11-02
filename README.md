# Seedsman's Hedges — quoting and customers

Staff website for quoting hedge trimming by **square metre of hedge face**, measured on aerial imagery with
the GeoCanvas measure tool, plus a customer portal that keeps each customer's properties, measured hedges and quotes.

Live at `https://seedsmans.dirt3boy47.workers.dev` (Cloudflare Worker `seedsmans`, deployed on every push to `main`).

## Using it

**Sign in** at `/login.html`. Everything except the home page needs a staff login.

### New quote (`/quote/hedge.html`)
1. Find the address (or ◎ for your location on site). The house pin drops on the property; drag it if needed.
2. **+ Measure a hedge**, then on the map:
   - **Line**: tap along the hedge; or tick **Freehand** and trace it with a finger, the mouse or a pencil
     (curved hedges: the length follows the curve). Two fingers still move the map.
   - **Area**: tap (or trace) the hedge's outline from above; its length and depth are worked out from the outline.
   - Drag points to adjust, **Undo** removes the last point or traced stretch, then **Done**.
3. On each hedge set **height** and **depth** (length comes from the map, and can be changed), the **condition**, and tick
   the faces to cut: **Top, Front, Back, LHS end, RHS end**. The m² of each face and the hours show straight away.
4. **Job**: green waste removal and travel km. The price breakdown updates as you go.
5. Choose an existing customer or type a new one with the property address, then **Save quote**.
   Saving again makes a new revision (history is kept). Set the status (Draft, Sent, Accepted, Declined).
6. **Copy**, **Email** or **Print** the quote.

### Customers (`/customers/`)
Search and add customers. A customer page shows their details, quotes, and each property with its house pin,
the hedges measured there (drawn on the map, with sizes, faces and m²), and **+ New quote**, which starts a quote
with that property's hedges already in it.

### Rates & settings (`/settings.html`)
The rate card (all prices excluding GST), business details shown on quotes, staff logins and your password.
Saving the rate card makes a new version; saved quotes keep the version they were priced with.

## How a quote is priced (`public/js/rates.js`)

For each hedge (length L, height H, depth D):

| Face | Area |
|---|---|
| Front, Back | L × H each |
| Top | L × D (counted × *top factor*, default 1.2, for time) |
| LHS end, RHS end | D × H each |

- **Height tier** (by H) gives the m² one person trims per hour. Suggested: up to 1.2 m 45, up to 2 m 35,
  up to 3 m 25, up to 4.5 m 16, up to 8 m 11.
- **Condition** multiplies time and green waste: maintained ×1, overgrown ×1.5 time / ×2.5 waste, hard cut ×2.5 / ×5.
- Person-hours = Σ(face m² ÷ tier rate × condition) + setup (0.5 h × crew) + loading waste, rounded up to ¼ h,
  charged at the labour rate ($65/h, crew of 2).
- **Cherry picker** when any hedge is taller than 3 m: half day $320 (up to 4 h of picker work on site) or $480 a day,
  plus $150 delivery.
- Green waste 0.02 m³ per m² cut at $65/m³; equipment $25 a job; travel $1.20/km; 5% contingency;
  $180 minimum; then GST 10%.

These are starting figures to check against your own; change them on the Rates & settings page.

## Data

Cloudflare D1 database `seedsmans`. Tables used: `customers`, `properties` (with `lat`, `lng` from
`migrations/0004_property_location.sql`), `hedge_assets`, `hedge_measurements` (GeoJSON geometry + sizes, a new row
each time a hedge is re-measured), `quotes` and `quote_revisions`, `rate_library`, `business_settings`, `user`,
`account`, `session`, `request_limits`, `audit_log`. The other tables (jobs, invoices, enquiries…) were in the
database already and are not used yet. `schema/existing.sql` is a copy of the tables as they were.

Passwords are stored as salted PBKDF2 hashes and sessions as hashes of their tokens; 10 wrong sign-ins from one
connection lock it out for 10 minutes. The Worker recalculates every saved quote with the active rate card.

## Files

- `worker/index.js`: the API (`/api/…`) and static file serving
- `public/js/rates.js`: rate card defaults and the quote calculation (used by the browser and the Worker)
- `public/js/measure.js`, `public/js/geo.js`: GeoCanvas measure tool and ground distance/area maths
- `public/js/map.js`: aerial imagery (Vicmap, Esri world, QLD) and address search
- `public/quote/hedge.html`, `public/js/hedge-quote.js`: the quote page
- `public/customers/`, `public/settings.html`, `public/login.html`: the other staff pages

## Local testing

```bash
npx wrangler d1 execute seedsmans --local --file schema/existing.sql
npx wrangler d1 execute seedsmans --local --file migrations/0004_property_location.sql
npx wrangler dev
```
Then add a login to the local database (see `worker/index.js` for the password format).
