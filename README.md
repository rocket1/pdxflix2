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
- For each movie, the scraper tries to look up the real US theatrical release
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
  that fetches `data/movies.json` and renders it — alphabetical movie list,
  click a title to expand theaters/showtimes, search box, and an All / First
  Run / Second Run filter.

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
