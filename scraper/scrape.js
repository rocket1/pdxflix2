#!/usr/bin/env node
/**
 * PDXFlix scraper
 *
 * Pulls "now playing" movies + showtimes for the Portland, OR metro area from
 * cinemaclock.com (a free, ad-supported showtimes aggregator whose listing
 * and per-movie pages are plain server-rendered HTML -- no API key needed).
 * robots.txt for cinemaclock.com only disallows /aw/*, which this script
 * never touches.
 *
 * Each movie's own /movies/<slug> details page (also on cinemaclock.com)
 * supplies a synopsis, director, cast, and a large poster image -- all free,
 * no key required.
 *
 * Separately, the script tries to look up the real theatrical release date
 * from TMDB (https://www.themoviedb.org/) so the frontend can flag movies
 * playing well past their first-run window as "second run". TMDB is free
 * but requires your own API key (see README.md) -- if you don't set one,
 * the script falls back to estimating the release date from CinemaClock's
 * own "Nth week" / release-year text, which is coarser but works with zero
 * setup.
 *
 * Usage:
 *   node scraper/scrape.js
 *   TMDB_API_KEY=xxxx node scraper/scrape.js
 *
 * Output: data/movies.json (consumed by index.html / js/app.js)
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const CITY_PATH = 'portland-or';
const BASE = 'https://www.cinemaclock.com';
const USER_AGENT =
  'Mozilla/5.0 (compatible; pdxflix2-scraper/1.0; personal showtimes aggregator)';

// A movie still playing this many days (or more) after its US theatrical
// release date is treated as "second run" (i.e. likely to have moved to a
// discount / repertory house like Academy Theater, Laurelhurst, etc).
const SECOND_RUN_DAYS = Number(process.env.SECOND_RUN_DAYS) || 45;

// Be polite to a free, unauthenticated source: throttle requests.
const REQUEST_DELAY_MS = 350;

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Parse the "now playing" listing page into a de-duplicated movie array. */
function parseNowPlaying(html) {
  const $ = cheerio.load(html);
  const seenMid = new Set();
  const movies = [];

  $('.movieblock').each((_, el) => {
    const $el = $(el);

    // CinemaClock lists dubbed/subtitled duplicates as separate "movieblock"
    // entries (e.g. a French-dub card pointing at the same underlying film).
    // Skip those; keep only the original-title entry.
    const other = $el.find('.movietitleother').first().text();
    if (/version of/i.test(other)) return;

    const mid = $el.find('.smallposter').attr('data-mid');
    if (mid && seenMid.has(mid)) return;
    if (mid) seenMid.add(mid);

    const titleLink = $el.find('h3.movietitle a').first();
    const title = titleLink.text().trim();
    const detailHref = titleLink.attr('href') || '';
    const slug = detailHref.replace(/^\/movies\//, '');
    if (!title || !slug) return;

    const timesHref = $el.find("a[href^='/movie-times/']").first().attr('href') || '';
    const timesSlug = timesHref.replace(/^\/movie-times\//, '');

    const badge = $el.find('.button16.btntim .butsub').first().text().trim();
    const showtimeCount = /^\d+$/.test(badge) ? Number(badge) : 0;

    const rating = $el.find("[class^='rt']").first().text().trim();

    const genreP = $el.find('p.moviegenre').clone();
    genreP.find("[class^='rt']").remove();
    genreP.find('.avec').remove();
    genreP.find('.playingwarn').remove();
    const genreText = genreP.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

    const runtimeMatch = genreText.match(/(\d+)h(\d+)m/);
    const runtime = runtimeMatch ? `${runtimeMatch[1]}h ${runtimeMatch[2]}m` : '';
    const runtimeMinutes = runtimeMatch
      ? Number(runtimeMatch[1]) * 60 + Number(runtimeMatch[2])
      : null;

    const weekMatch = genreText.match(/(\d+)(?:st|nd|rd|th) week/i);
    const week = weekMatch ? Number(weekMatch[1]) : null;

    const yearMatch = genreText.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : null;

    let genre = genreText;
    if (runtimeMatch) genre = genre.replace(runtimeMatch[0], '');
    if (weekMatch) genre = genre.replace(weekMatch[0], '');
    if (yearMatch) genre = genre.replace(yearMatch[0], '');
    genre = genre.replace(/\s+/g, ' ').trim();

    const posterPath = $el.find('.smallposter').attr('data-src') || '';
    const poster = posterPath ? BASE + posterPath : '';

    const playingWarn = $el.find('.playingwarn').text().trim();

    movies.push({
      title,
      slug,
      timesSlug: timesSlug || slug,
      rating,
      runtime,
      runtimeMinutes,
      genre,
      year,
      week,
      poster,
      showtimeCount,
      upcoming: Boolean(playingWarn),
      playingNote: playingWarn || null,
    });
  });

  movies.sort((a, b) => a.title.localeCompare(b.title));
  return movies;
}

/** Parse a single movie's /movie-times/<slug> page into theater + times. */
function parseMovieTimes(html) {
  const $ = cheerio.load(html);
  const theaterMap = new Map();

  $('.showtimeblock').each((_, el) => {
    const $el = $(el);
    const nameEl = $el.find('table.cinemaheader h3 a').first();
    const name = nameEl.text().trim();
    if (!name) return;
    const theaterHref = nameEl.attr('href') || '';
    const address = $el.find('em.address').first().text().replace(/\s+/g, ' ').trim();

    if (!theaterMap.has(name)) {
      theaterMap.set(name, { name, address, slug: theaterHref.replace(/^\/movie-theaters\//, ''), times: new Set() });
    }
    const entry = theaterMap.get(name);

    // Only "today" showtimes (class .times, not .timesother which covers
    // other dates or duplicate per-format listings).
    $el.find('p.times span[data-time]').each((__, t) => {
      const raw = $(t).attr('data-time'); // e.g. "1410" -> 14:10, "930" -> 09:30
      if (!raw) return;
      const padded = raw.padStart(4, '0');
      const hh = padded.slice(0, 2);
      const mm = padded.slice(2, 4);
      entry.times.add(`${hh}:${mm}`);
    });
  });

  return Array.from(theaterMap.values())
    .map((t) => ({ ...t, times: Array.from(t.times).sort() }))
    .filter((t) => t.times.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parse a movie's /movies/<slug> details page for synopsis, director, cast,
 * and a large poster -- all present in plain HTML on CinemaClock itself, so
 * this works with zero API keys. TMDB (if configured) can still override
 * any of these with richer data.
 */
function parseMovieDetails(html) {
  const $ = cheerio.load(html);

  const synopsis = $('#synopsis').text().replace(/\s+/g, ' ').trim() || null;
  const director = $('[itemprop="director"] [itemprop="name"]').first().text().trim() || null;
  const cast = $('[itemprop="actor"] [itemprop="name"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 6);

  const posterSrc = $('#mainposter img').attr('src') || '';
  const poster = posterSrc ? (posterSrc.startsWith('http') ? posterSrc : BASE + posterSrc) : null;

  return { synopsis, director, cast, poster };
}

async function fetchTmdbInfo(title, year) {
  if (!TMDB_API_KEY) return null;
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    query: title,
    include_adult: 'false',
  });
  if (year) params.set('year', String(year));
  const url = `${TMDB_BASE}/search/movie?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const match = json.results && json.results[0];
    if (!match) return null;
    return {
      releaseDate: match.release_date || null,
      overview: match.overview || null,
      tmdbId: match.id,
      posterPath: match.poster_path
        ? `https://image.tmdb.org/t/p/w342${match.poster_path}`
        : null,
    };
  } catch {
    return null;
  }
}

function estimateReleaseDate(movie, today) {
  // Coarse fallback used when there is no TMDB key / match: derive an
  // approximate release date from CinemaClock's own "Nth week" counter, or
  // fall back further to the release year.
  if (movie.week) {
    const d = new Date(today);
    d.setDate(d.getDate() - (movie.week - 1) * 7);
    return { releaseDate: d.toISOString().slice(0, 10), source: 'week-estimate' };
  }
  if (movie.year) {
    return { releaseDate: `${movie.year}-07-01`, source: 'year-only' };
  }
  return { releaseDate: null, source: 'unknown' };
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

async function main() {
  console.log(`[pdxflix2] Fetching now-playing list for ${CITY_PATH} ...`);
  const listHtml = await fetchHtml(`${BASE}/${CITY_PATH}/movies-now-playing`);
  const movies = parseNowPlaying(listHtml);
  console.log(`[pdxflix2] Found ${movies.length} distinct movies.`);

  const today = new Date();
  const results = [];

  for (const movie of movies) {
    if (movie.showtimeCount > 0) {
      try {
        const url = `${BASE}/${CITY_PATH}/movie-times/${movie.timesSlug}`;
        const html = await fetchHtml(url);
        movie.theaters = parseMovieTimes(html);
      } catch (err) {
        console.warn(`[pdxflix2] Failed to fetch showtimes for ${movie.title}: ${err.message}`);
        movie.theaters = [];
      }
      await sleep(REQUEST_DELAY_MS);
    } else {
      movie.theaters = [];
    }

    // Skip movies that never resolved to any actual playing theater today
    // (e.g. future releases, or festival one-offs already ended).
    if (movie.theaters.length === 0) continue;

    let details = null;
    try {
      const detailsHtml = await fetchHtml(`${BASE}/movies/${movie.slug}`);
      details = parseMovieDetails(detailsHtml);
    } catch (err) {
      console.warn(`[pdxflix2] Failed to fetch details for ${movie.title}: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);

    const tmdb = await fetchTmdbInfo(movie.title, movie.year);
    if (TMDB_API_KEY) await sleep(120);

    let releaseDate, releaseDateSource;
    if (tmdb && tmdb.releaseDate) {
      releaseDate = tmdb.releaseDate;
      releaseDateSource = 'tmdb';
    } else {
      const est = estimateReleaseDate(movie, today);
      releaseDate = est.releaseDate;
      releaseDateSource = est.source;
    }

    let daysSinceRelease = null;
    let isSecondRun = false;
    if (releaseDate) {
      daysSinceRelease = daysBetween(new Date(releaseDate), today);
      isSecondRun = daysSinceRelease >= SECOND_RUN_DAYS;
    }
    const isClassic = movie.year ? today.getFullYear() - movie.year >= 3 : false;

    results.push({
      title: movie.title,
      slug: movie.slug,
      rating: movie.rating || null,
      runtime: movie.runtime || null,
      runtimeMinutes: movie.runtimeMinutes,
      genre: movie.genre || null,
      year: movie.year,
      week: movie.week,
      poster: (tmdb && tmdb.posterPath) || (details && details.poster) || movie.poster || null,
      synopsis: (tmdb && tmdb.overview) || (details && details.synopsis) || null,
      cast: (details && details.cast) || [],
      director: (details && details.director) || null,
      releaseDate,
      releaseDateSource,
      daysSinceRelease,
      isSecondRun,
      isClassic,
      theaters: movie.theaters,
    });

    console.log(
      `[pdxflix2] ${movie.title} — ${movie.theaters.length} theater(s), ` +
        `release ${releaseDate || 'unknown'} (${releaseDateSource})${isSecondRun ? ' [SECOND RUN]' : ''}`
    );
  }

  results.sort((a, b) => a.title.localeCompare(b.title));

  const output = {
    city: 'Portland, OR',
    source: 'cinemaclock.com',
    generatedAt: new Date().toISOString(),
    secondRunThresholdDays: SECOND_RUN_DAYS,
    tmdbEnabled: Boolean(TMDB_API_KEY),
    movies: results,
  };

  const outPath = path.join(__dirname, '..', 'data', 'movies.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`[pdxflix2] Wrote ${results.length} movies to ${outPath}`);
}

main().catch((err) => {
  console.error('[pdxflix2] Scrape failed:', err);
  process.exit(1);
});
