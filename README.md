# PDXFlix

A movie-times board for Portland, OR. Static frontend (`index.html`) reads a
JSON file produced by a small scraper; no server framework required.

## How it works

- **`scraper/scrape.js`** fetches the "now playing" list and per-movie
  showtimes pages from [cinemaclock.com](https://www.cinemaclock.com), a free
  showtimes aggregator, for the Portland, OR metro area. Those pages are
  plain server-rendered HTML (no login/API key needed), and `robots.txt` only
  disallows `/aw/*`, which this scraper never touches. It writes the result
  to `data/movies.json`.
- Each movie's own `/movies/<slug>` details page on CinemaClock also has a
  synopsis, director, cast, and a large poster — all plain HTML, so this
  works with zero API keys.
- Separately, the scraper tries to look up the real US theatrical release
  date from [TMDB](https://www.themoviedb.org/) (needs your own free API key,
  see below). A movie still playing **45+ days** after that release date
  (configurable) is flagged `isSecondRun: true` — this is how the "Second
  Run" filter in the UI works, matching how films migrate from first-run
  multiplexes to Portland's discount/second-run houses (Academy Theater,
  Laurelhurst, etc.).
- If no TMDB key is set, release date is estimated instead from CinemaClock's
  own "Nth week in theaters" counter (or release year for older
  revival/repertory screenings) — coarser, but works with zero setup.
- **`index.html` + `css/style.css` + `js/app.js`** is a plain static page
  that fetches `data/movies.json` and renders it. The search box and the
  All / First Run / Second Run filter sit in the toolbar and apply to both
  tabs below them:
  - **Movies tab** (default): alphabetical movie list. Clicking a title
    navigates to a movie subpage (poster image, rating/runtime/genre,
    release date, director, cast, synopsis, and theaters/showtimes) at the
    URL `#/movie/<slug>` — shareable/bookmarkable. A single back arrow in
    the header's top-left (not repeated in every subpage) returns to
    whichever list tab was active, and the list's scroll position is
    restored rather than snapping back to the top.
  - **Theatres tab**: alphabetical theater list instead — click a theater to
    expand every movie playing there today with its showtimes, inline. This
    is built client-side by inverting the same `data/movies.json`, so it
    stays in sync automatically; clicking a movie inside a theater opens
    that movie's subpage.
  - Each of the three (Movies tab / Theatres tab / a movie's subpage) has its
    own page background — green, dark purple, and pink — set via a
    `data-page` attribute on `<body>` (see `body[data-page="..."]` in
    `css/style.css`) so it's obvious at a glance which one you're in.
  - The subpage's poster is pre-sized to its final aspect ratio and shows a
    small spinner while the image loads, so the layout doesn't jump.
  - A small **"Advertise with us"** link in the top-right corner (`#/advertise`)
    opens a fully mocked ad flow: create an ad (headline, body text, and an
    image — read client-side with `FileReader`, never uploaded anywhere) →
    preview how it'd look → a demo payment step (fake card fields, no real
    processor, nothing is ever sent over the network) → a confirmation
    screen with a fake order number and a **stats page link**
    (`#/stats/<token>`). It's a UI demo only.
  - The stats page lists every ad "purchased" from this browser (one row
    each, like the Theatres tab's expandable rows) — expanding a row shows
    mock impressions, click-throughs, and CTR. There's no backend: purchased
    ads and a per-browser "advertiser token" are saved to `localStorage`, and
    the mock stats are generated once at purchase time and stored alongside
    the ad, so they stay the same on repeat visits instead of re-rolling.

## Usage

```bash
npm install          # installs cheerio, used only by the scraper
npm run scrape        # writes data/movies.json
npm run serve          # serves the site at http://localhost:8080 (fetch() needs http://, not file://)
```

Then open `index.html` via the server (opening the file directly with
`file://` will fail to `fetch()` the JSON due to browser sandboxing — any
static file server works, `npm run serve` is just a zero-dependency one).

### Optional: enable TMDB for accurate release dates

```bash
export TMDB_API_KEY=your_free_key_here
npm run scrape
```

Get a free key at https://www.themoviedb.org/settings/api (personal/
non-commercial use is free, approval is usually instant).

### Re-running

Showtimes change daily — re-run `npm run scrape` (e.g. via cron) to refresh
`data/movies.json`. The scraper throttles requests (~350ms between pages) to
stay polite to the free source.

## Tuning "second run"

Edit `SECOND_RUN_DAYS` at the top of `scraper/scrape.js`, or set the env var:

```bash
SECOND_RUN_DAYS=60 npm run scrape
```
