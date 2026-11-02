# Seedsman Service website

A simple static website with a **hedge quote** page. The quote page uses a cut-down version of
GeoCanvas: the same Queensland aerial imagery, the same measure tool and the same ground-distance maths.

## Hedge quote (`public/quote/hedge.html`)

1. Type the address and tap **Find** (or tap ◎ for your own location when you're on site).
2. Tap **+ Measure a hedge**, then tap along the hedge on the aerial photo. Drag a point to move it,
   **Undo** removes the last point. Tap **Done**.
3. Set the hedge's height, one side or both, and whether the top is cut. Add more hedges the same way,
   or use **+ Type a length** if you already know it. You can also change any length by hand.
4. Tick **Take the green waste away** if needed. The total updates as you go.
5. Fill in the customer and **Copy quote**, **Email quote** (opens your mail app) or **Print**.

The quote in progress is kept in the browser, so a reload doesn't lose it. **New quote** clears it.

## Changing prices

Edit `public/js/config.js`. Prices are per metre for one side of the hedge, by height band, plus extras
for the top and green waste, a call-out fee and a minimum charge. Your phone, email and ABN go there too.

## Files

- `public/index.html`: home page
- `public/quote/hedge.html`, `public/js/hedge-quote.js`: the hedge quote
- `public/js/geo.js`: distance on the ground (from GeoCanvas `js/geo.js`)
- `public/js/config.js`: prices and business details
- `public/vendor/`: Leaflet 1.9.4 (map library, copied from GeoCanvas)

## Putting it online

It's plain files, no build step. Either:

- **Cloudflare Pages**: upload the `public` folder (or connect this repository with `public` as the
  output directory), or
- **Cloudflare Workers**: `npx wrangler deploy` from this folder (uses `wrangler.jsonc`).

Use the `https://` address: GPS (◎) only works on secure sites.
