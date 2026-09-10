# Marquee

Static hip hop & R&B live event aggregator. Pulls upcoming shows from
Bandsintown's public API for a curated artist list, filters to a curated
list of US cities, and rebuilds a static site every 6 hours via GitHub
Actions. No server, no database — everything ships as plain HTML on
GitHub Pages.

## One-time setup

1. **Create a GitHub repo** and push this folder to it (`main` branch).
2. **Enable GitHub Pages**: repo Settings → Pages → Source = "Deploy from
   a branch" → Branch = `main`, folder = `/docs`. Save.
3. **(Recommended) Get a free Bandsintown app_id**: sign up at
   [bandsintown.com](https://bandsintown.com) as an app developer, then
   add it as a repo secret named `BANDSINTOWN_APP_ID`
   (Settings → Secrets and variables → Actions → New repository secret).
   Without this, the fetch script uses a placeholder id, which works for
   light/testing traffic but may get rate-limited at scale.
4. **Get a Ticketmaster Discovery API key**: sign up at
   [developer.ticketmaster.com](https://developer.ticketmaster.com/),
   create an app, and copy the Consumer Key. Add it as a repo secret
   named `TICKETMASTER_API_KEY`. Unlike Bandsintown, there's no anonymous
   fallback here — without this secret set, the script just skips
   Ticketmaster and runs on Bandsintown alone (it won't fail the build).

   **Important trade-off:** Ticketmaster's event `url` is their ticket
   checkout page — Ticketmaster doesn't expose a separate "info only"
   page in the API the way Bandsintown does. So adding this source means
   some shows on your site will now link to a buy-tickets flow, which is
   the opposite of what you asked for originally. Bandsintown-sourced
   shows are unaffected — this only applies to shows that came in through
   Ticketmaster. Options if that matters to you:
   - Leave it as-is and accept the mix (simplest, most coverage).
   - Only use Ticketmaster data to *enrich* a Bandsintown-sourced listing
     (better venue/date accuracy) while still linking out to Bandsintown's
     page — I can wire that up if you want it instead of what's here.
   - Drop Ticketmaster-only shows (ones Bandsintown didn't also find)
     rather than showing them with a ticket-page link.
5. **Run the workflow once manually**: Actions tab → "Update event data
   & rebuild site" → Run workflow. This populates `data/events.json` and
   `docs/` for the first time.
6. Update `SITE_URL` in `scripts/build-site.mjs` to your actual Pages URL
   (e.g. `https://yourname.github.io/marquee`) once you know it, and
   re-run the workflow — this feeds your sitemap and canonical tags.

After that, it runs itself: every 6 hours the workflow re-fetches events,
rebuilds the static pages, and commits the changes.

## Editing what's covered

- `data/cities.json` — the city/state list. Add, remove, or reorder
  freely; the `slug` field controls the URL (`/cities/<slug>/`).
- `data/artists.json` — the artist list queried against Bandsintown.
  Bigger list = more coverage, but also more API calls per run (there's
  a small delay between each to stay polite to the API).

## Design notes

- Every show links out via `eventUrl`, which Bandsintown returns as the
  event's own page — not a ticket-purchase deep link. There's no
  "Buy Tickets" CTA anywhere in the templates on purpose.
- The site never fetches anything client-side — every page is fully
  pre-rendered HTML, so it's fast and crawlable (matters both for Core
  Web Vitals and for SEO-driven traffic, which is where ad revenue
  actually comes from at this kind of site).
- `.ad-slot` divs in `docs/assets/style.css` / the generated HTML mark
  where ad units go. Swap them for your AdSense/Ezoic/whatever script
  tags once you've been approved — that approval process happens outside
  this repo, on the ad network's site, and generally wants a live URL
  with real content first.

## Known limitations (MVP)

- Bandsintown's free/no-signup tier is not officially rate-limit-free at
  scale — get an app_id before you lean on this in production.
- City matching relies on Bandsintown's venue city/region fields, which
  are not always clean; a few real shows will get missed and a few
  mismatches are possible. Worth spot-checking `data/events.json`
  periodically.
- Only one data source (Bandsintown) is wired up. Ticketmaster's
  Discovery API and Songkick's API would meaningfully increase coverage
  but both require a free signup for an API key — the fetch script is
  structured so a second source is a new function alongside
  `fetchArtistEvents`, not a rewrite.
- Genre coverage is only as good as the curated artist list in
  `data/artists.json` — there's no genre metadata to filter on
  automatically, so it's a manual, editable list.
