(function () {
  const state = {
    movies: [],
    filter: 'all', // 'all' | 'first' | 'second'
    view: 'movies', // 'movies' | 'theatres'
    query: '',
    openTheatre: null,
    openAdId: null,
    expandedTheatreAds: {},
    listScrollY: 0,
    meta: null,
  };

  // Draft ad content for the mocked "Advertise with us" flow. Kept outside
  // `state` since it has nothing to do with movie data, and persists across
  // steps (but not across a full page reload -- there's no backend to save
  // it to, this is a demo flow only).
  const adState = {
    step: 1,
    headline: '',
    description: '',
    imageDataUrl: null,
    theatreNames: [],
    cardName: '',
    cardNumber: '',
    cardExpiry: '',
    cardCvc: '',
    orderId: null,
  };
  const AD_PRICE = '$99.00';
  const THEATRE_ADS_PREVIEW_LIMIT = 3;

  // Purchased ads persist to localStorage so the stats-page link shown at
  // checkout keeps working after a reload. There's no real backend/account
  // system here -- one "advertiser token" per browser stands in for one.
  const ADVERTISER_TOKEN_KEY = 'pdxflix_advertiser_token';
  const ADS_KEY = 'pdxflix_ads';

  function getAdvertiserToken() {
    try {
      let token = localStorage.getItem(ADVERTISER_TOKEN_KEY);
      if (!token) {
        token = Math.random().toString(36).slice(2, 10);
        localStorage.setItem(ADVERTISER_TOKEN_KEY, token);
      }
      return token;
    } catch {
      return 'demo';
    }
  }

  function loadAds() {
    try {
      return JSON.parse(localStorage.getItem(ADS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveAd(ad) {
    try {
      const ads = loadAds();
      ads.push(ad);
      localStorage.setItem(ADS_KEY, JSON.stringify(ads));
    } catch {
      // Storage unavailable (private browsing, etc.) -- non-critical for a
      // demo flow, the stats link just won't have anything behind it.
    }
  }

  const listViewEl = document.getElementById('listView');
  const detailPageEl = document.getElementById('movieDetailPage');
  const advertisePageEl = document.getElementById('advertisePage');
  const statsPageEl = document.getElementById('statsPage');
  const adDetailPageEl = document.getElementById('adDetailPage');
  const headerBackBtn = document.getElementById('headerBack');
  const listEl = document.getElementById('movieList');
  const metaEl = document.getElementById('metaLine');
  const searchEl = document.getElementById('searchInput');
  const filterButtons = Array.from(document.querySelectorAll('#filterToggle button'));
  const tabButtons = Array.from(document.querySelectorAll('#viewTabs button'));

  function portlandNowMinutes() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hh = Number(parts.find((p) => p.type === 'hour').value);
    const mm = Number(parts.find((p) => p.type === 'minute').value);
    return hh * 60 + mm;
  }

  function to12h(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return m === 0 ? `${h12}:00` : `${h12}:${String(m).padStart(2, '0')}`;
  }

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  function timeSpanHtml(time, nowMin) {
    const label = to12h(time);
    return toMinutes(time) < nowMin
      ? `<span class="time-past">${label}</span>`
      : `<span class="time-pill">${label}</span>`;
  }

  function theaterRowsHtml(theaters, nowMin) {
    return theaters
      .map((t) => {
        const timesHtml = t.times.map((time) => timeSpanHtml(time, nowMin)).join('');
        return `
        <div class="theater-row">
          <div class="theater-name"><a href="https://www.google.com/search?q=${encodeURIComponent(t.name + ' ' + t.address)}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a></div>
          <div class="times">${timesHtml}</div>
        </div>`;
      })
      .join('');
  }

  function matchesFilter(movie) {
    if (state.filter === 'second') return movie.isSecondRun;
    if (state.filter === 'first') return !movie.isSecondRun;
    return true;
  }

  function matchesQuery(movie) {
    if (!state.query) return true;
    return movie.title.toLowerCase().includes(state.query);
  }

  function visibleMovies() {
    return state.movies.filter((m) => matchesFilter(m) && matchesQuery(m));
  }

  /** Invert the movie-centric data into a theatre-centric list. */
  function buildTheatres(movies) {
    const map = new Map();
    movies.forEach((movie) => {
      (movie.theaters || []).forEach((t) => {
        if (!t.times || !t.times.length) return;
        if (!map.has(t.name)) map.set(t.name, { name: t.name, address: t.address, movies: [] });
        map.get(t.name).movies.push({
          slug: movie.slug,
          title: movie.title,
          rating: movie.rating,
          runtime: movie.runtime,
          genre: movie.genre,
          isSecondRun: movie.isSecondRun,
          isClassic: movie.isClassic,
          times: t.times,
        });
      });
    });
    return Array.from(map.values())
      .map((th) => ({ ...th, movies: th.movies.sort((a, b) => a.title.localeCompare(b.title)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** All known theatre names (unfiltered by search/tab state), for the ad theatre picker. */
  function allTheatreNames() {
    return buildTheatres(state.movies).map((t) => t.name);
  }

  /** Purchased ads targeting a given theatre, most-recent first. */
  function adsForTheatre(theatreName) {
    return loadAds()
      .filter((ad) => Array.isArray(ad.theatreNames) && ad.theatreNames.includes(theatreName))
      .sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt));
  }

  // Swaps the page background (green/purple/pink) via a data attribute on
  // <body>; see the body[data-page="..."] rules in css/style.css.
  function applyBodyBackground(page) {
    document.body.dataset.page = page;
  }

  function renderMeta() {
    if (!state.meta) return;
    const generated = new Date(state.meta.generatedAt);
    const when = generated.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    metaEl.textContent = `${state.meta.city} · ${state.meta.movies.length} movies showing · data from ${state.meta.source}, updated ${when} · second-run = playing ${state.meta.secondRunThresholdDays}+ days after release`;
  }

  // ---- Routing: '#/movie/<slug>' opens a subpage, anything else is the list ----

  function parseRoute() {
    if (location.hash === '#/advertise') return { type: 'advertise' };
    const statsMatch = location.hash.match(/^#\/stats\/(.+)$/);
    if (statsMatch) return { type: 'stats', token: decodeURIComponent(statsMatch[1]) };
    const adMatch = location.hash.match(/^#\/ad\/(.+)$/);
    if (adMatch) return { type: 'ad', id: decodeURIComponent(adMatch[1]) };
    const match = location.hash.match(/^#\/movie\/(.+)$/);
    if (match) return { type: 'movie', slug: decodeURIComponent(match[1]) };
    return { type: 'list' };
  }

  function goToMovie(slug) {
    location.hash = '#/movie/' + encodeURIComponent(slug);
  }

  // Single back control lives in the header (see #headerBack in index.html)
  // instead of a repeated link inside each subpage; it always just clears
  // the hash, which routes back to whichever list tab was active.
  function goBack() {
    location.hash = '';
  }

  function renderRoute() {
    // Remember where the list was scrolled to before leaving it, so
    // returning to it (via the header back button) restores that position
    // instead of snapping to the top.
    if (!listViewEl.hidden) {
      state.listScrollY = window.scrollY;
    }

    const route = parseRoute();

    if (route.type === 'advertise') {
      // Scroll to the top *before* swapping content, while the (usually
      // taller) list is still in the DOM -- doing it after would let the
      // browser's own scroll-clamping (triggered by the sudden height
      // change) fight with this call and produce a visible double-jump/
      // flash around the sticky header.
      window.scrollTo(0, 0);
      listViewEl.hidden = true;
      detailPageEl.hidden = true;
      statsPageEl.hidden = true;
      adDetailPageEl.hidden = true;
      advertisePageEl.hidden = false;
      headerBackBtn.hidden = false;
      applyBodyBackground('advertise');
      renderAdvertisePage();
      return;
    }

    if (route.type === 'stats') {
      window.scrollTo(0, 0);
      listViewEl.hidden = true;
      detailPageEl.hidden = true;
      advertisePageEl.hidden = true;
      adDetailPageEl.hidden = true;
      statsPageEl.hidden = false;
      headerBackBtn.hidden = false;
      applyBodyBackground('stats');
      renderStatsPage(route.token);
      return;
    }

    if (route.type === 'ad') {
      window.scrollTo(0, 0);
      listViewEl.hidden = true;
      detailPageEl.hidden = true;
      advertisePageEl.hidden = true;
      statsPageEl.hidden = true;
      adDetailPageEl.hidden = false;
      headerBackBtn.hidden = false;
      applyBodyBackground('ad');
      renderAdDetailPage(route.id);
      return;
    }

    if (route.type === 'movie') {
      const movie = state.movies.find((m) => m.slug === route.slug);
      if (movie) {
        window.scrollTo(0, 0);
        listViewEl.hidden = true;
        advertisePageEl.hidden = true;
        statsPageEl.hidden = true;
        adDetailPageEl.hidden = true;
        detailPageEl.hidden = false;
        headerBackBtn.hidden = false;
        applyBodyBackground('detail');
        detailPageEl.innerHTML = renderMovieSubpage(movie, portlandNowMinutes());
        return;
      }
    }

    listViewEl.hidden = false;
    detailPageEl.hidden = true;
    advertisePageEl.hidden = true;
    statsPageEl.hidden = true;
    adDetailPageEl.hidden = true;
    headerBackBtn.hidden = true;
    applyBodyBackground(state.view);
    renderList();
    window.scrollTo(0, state.listScrollY || 0);
  }

  // ---- List view (Movies / Theatres tabs) ----

  function renderList() {
    const nowMin = portlandNowMinutes();
    if (state.view === 'theatres') {
      renderTheatresView(nowMin);
    } else {
      renderMoviesView(nowMin);
    }
  }

  function renderMoviesView() {
    const visible = visibleMovies();

    if (visible.length === 0) {
      listEl.innerHTML = '<div class="no-results">No movies match that search/filter.</div>';
      return;
    }

    listEl.innerHTML = visible
      .map((movie) => {
        const badges = [];
        if (movie.isSecondRun) badges.push('<span class="badge second-run">Second Run</span>');
        if (movie.isClassic) badges.push('<span class="badge classic">Classic</span>');

        return `
        <div class="movie-row">
          <button class="movie-row-header" data-goto="${escapeAttr(movie.slug)}">
            <span class="title-wrap">
              <span>${escapeHtml(movie.title)}</span>
              ${badges.join('')}
            </span>
            <span class="chevron">&#9656;</span>
          </button>
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => goToMovie(btn.getAttribute('data-goto')));
    });
  }

  function renderTheatresView(nowMin) {
    const theatres = buildTheatres(visibleMovies());

    if (theatres.length === 0) {
      listEl.innerHTML = '<div class="no-results">No theaters match that search/filter.</div>';
      return;
    }

    listEl.innerHTML = theatres
      .map((theatre) => {
        const isOpen = theatre.name === state.openTheatre;
        const count = `${theatre.movies.length} movie${theatre.movies.length === 1 ? '' : 's'} today`;

        return `
        <div class="movie-row${isOpen ? ' open' : ''}" data-theatre="${escapeAttr(theatre.name)}">
          <button class="movie-row-header" data-toggle-theatre="${escapeAttr(theatre.name)}">
            <span class="title-wrap-outer">
              <span class="title-wrap"><span>${escapeHtml(theatre.name)}</span></span>
              <span class="row-subtitle">${theatre.address ? escapeHtml(theatre.address) + ' &nbsp;·&nbsp; ' : ''}${count}</span>
            </span>
            <span class="chevron">&#9656;</span>
          </button>
          <div class="movie-detail">
            ${isOpen ? renderTheatreDetail(theatre, nowMin) : ''}
          </div>
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('[data-toggle-theatre]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-toggle-theatre');
        state.openTheatre = state.openTheatre === name ? null : name;
        renderList();
      });
    });

    listEl.querySelectorAll('[data-jump-movie]').forEach((link) => {
      link.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        goToMovie(link.getAttribute('data-jump-movie'));
      });
    });

    listEl.querySelectorAll('[data-show-all-ads]').forEach((btn) => {
      btn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        state.expandedTheatreAds[btn.getAttribute('data-show-all-ads')] = true;
        renderList();
      });
    });
  }

  function renderTheatreDetail(theatre, nowMin) {
    const rows = theatre.movies
      .map((m) => {
        const badges = [];
        if (m.isSecondRun) badges.push('<span class="badge second-run">Second Run</span>');
        if (m.isClassic) badges.push('<span class="badge classic">Classic</span>');
        const metaBits = [m.rating, m.runtime, m.genre].filter(Boolean).join(' &nbsp;·&nbsp; ');
        const timesHtml = m.times.map((time) => timeSpanHtml(time, nowMin)).join('');

        return `
        <div class="theater-row">
          <div class="theater-name">
            <a href="#" data-jump-movie="${escapeAttr(m.slug)}">${escapeHtml(m.title)}</a>
            ${badges.join('')}
            ${metaBits ? `<span class="row-subtitle">${metaBits}</span>` : ''}
          </div>
          <div class="times">${timesHtml}</div>
        </div>`;
      })
      .join('');

    return (rows || '<div class="empty-detail">No movies found.</div>') + renderTheatreAdsHtml(theatre.name);
  }

  /** "Sponsored" section shown beneath a theatre's movie times, for ads targeting it. */
  function renderTheatreAdsHtml(theatreName) {
    const ads = adsForTheatre(theatreName);
    if (!ads.length) return '';

    const expanded = !!state.expandedTheatreAds[theatreName];
    const visibleAds = expanded ? ads : ads.slice(0, THEATRE_ADS_PREVIEW_LIMIT);
    const showAllBtn =
      !expanded && ads.length > THEATRE_ADS_PREVIEW_LIMIT
        ? `<button type="button" class="ad-show-all" data-show-all-ads="${escapeAttr(theatreName)}">Show all ${ads.length} ads &rarr;</button>`
        : '';

    return `
      <div class="theatre-ads">
        <h3 class="theatre-ads-heading">Sponsored</h3>
        <div class="theatre-ads-list">${visibleAds.map(theatreAdCardHtml).join('')}</div>
        ${showAllBtn}
      </div>
    `;
  }

  function theatreAdCardHtml(ad) {
    const imageInner = ad.imageDataUrl ? `<img src="${ad.imageDataUrl}" alt="" />` : '&#127916;';
    return `
      <a href="#/ad/${encodeURIComponent(ad.id)}" class="ad-preview-mock theatre-ad-card">
        <div class="ad-preview-image">${imageInner}</div>
        <div class="ad-preview-text">
          <div class="ad-preview-headline">${escapeHtml(ad.headline || '')}</div>
          <div class="ad-preview-body">${escapeHtml(ad.description || '')}</div>
          <span class="ad-preview-tag">Sponsored</span>
        </div>
      </a>
    `;
  }

  // ---- Ad detail subpage (what a moviegoer sees after clicking a sponsored ad) ----

  function renderAdDetailPage(id) {
    const ad = loadAds().find((a) => a.id === id);

    if (!ad) {
      adDetailPageEl.innerHTML = `
        <div class="ad-page">
          <div class="content-card empty-detail">Ad not found. It may have expired.</div>
        </div>
      `;
      return;
    }

    const imageInner = ad.imageDataUrl
      ? `<img src="${ad.imageDataUrl}" alt="" />`
      : '&#127916;';
    const theatresHtml = (ad.theatreNames || []).map((name) => `<li>${escapeHtml(name)}</li>`).join('');

    adDetailPageEl.innerHTML = `
      <div class="ad-page">
        <div class="content-card ad-detail-card">
          <div class="ad-detail-image">${imageInner}</div>
          <span class="ad-preview-tag">Sponsored</span>
          <h1 class="ad-detail-headline">${escapeHtml(ad.headline || 'Untitled ad')}</h1>
          ${ad.description ? `<p class="ad-detail-body">${escapeHtml(ad.description)}</p>` : ''}
          ${theatresHtml ? `<div class="ad-detail-theatres"><h3>Valid at</h3><ul>${theatresHtml}</ul></div>` : ''}
          <div class="ad-coupon">
            <div class="ad-coupon-label">Show this code at the box office</div>
            ${mockBarcodeSvg(ad.id)}
            <div class="ad-coupon-code">${escapeHtml(ad.id)}</div>
            <div class="ad-coupon-note">Demo coupon &mdash; not a real offer, scans to nothing.</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders a deterministic, QR-code-shaped SVG for a given seed string --
   * not a real, scannable barcode (there's no offer/URL to encode), just a
   * visual stand-in so the coupon looks legit. Same seed always produces the
   * same pattern, including 3 finder squares in the corners like a real QR
   * code, so a given ad's "coupon" looks stable across visits.
   */
  function mockBarcodeSvg(seed) {
    const modules = 17;
    const cell = 8;
    const quiet = 2;
    const size = (modules + quiet * 2) * cell;
    const rand = mulberry32(hashString(String(seed)));
    const finders = [
      [0, 0],
      [0, modules - 7],
      [modules - 7, 0],
    ];

    function finderAt(r, c) {
      return finders.find(([r0, c0]) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7);
    }
    function finderOn(r, c, r0, c0) {
      const lr = r - r0;
      const lc = c - c0;
      return lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4);
    }

    let rects = '';
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        const finder = finderAt(r, c);
        const on = finder ? finderOn(r, c, finder[0], finder[1]) : rand() > 0.55;
        if (on) {
          rects += `<rect x="${(c + quiet) * cell}" y="${(r + quiet) * cell}" width="${cell}" height="${cell}" />`;
        }
      }
    }

    return `<svg class="ad-coupon-barcode" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Mock coupon barcode">
      <rect width="${size}" height="${size}" fill="#fff" />
      <g fill="#111">${rects}</g>
    </svg>`;
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Movie subpage ----

  function renderMovieSubpage(movie, nowMin) {
    const metaParts = [];
    if (movie.rating) metaParts.push(movie.rating);
    if (movie.runtime) metaParts.push(movie.runtime);
    if (movie.genre) metaParts.push(movie.genre);
    if (movie.releaseDate) {
      const rd = new Date(movie.releaseDate + 'T00:00:00');
      metaParts.push(`Released ${rd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
    }

    const badges = [];
    if (movie.isSecondRun) badges.push('<span class="badge second-run">Second Run</span>');
    if (movie.isClassic) badges.push('<span class="badge classic">Classic</span>');

    // The frame is pre-sized (2:3 aspect ratio) so there's no layout jump;
    // the spinner shows until the image's onload/onerror fires.
    const posterHtml = movie.poster
      ? `<div class="poster-frame">
          <img class="poster-img" src="${escapeAttr(movie.poster)}" alt="${escapeAttr(movie.title)} poster"
               loading="lazy"
               onload="this.parentElement.classList.add('loaded')"
               onerror="this.parentElement.classList.add('errored')" />
          <div class="poster-spinner" aria-hidden="true"></div>
        </div>`
      : `<div class="poster-placeholder" aria-hidden="true">&#127916;</div>`;

    const creditParts = [];
    if (movie.director) creditParts.push(`Directed by ${movie.director}`);
    if (movie.cast && movie.cast.length) creditParts.push(`Starring ${movie.cast.join(', ')}`);

    const theatersHtml = theaterRowsHtml(movie.theaters || [], nowMin);

    return `
      <div class="movie-page">
        <div class="movie-page-poster">${posterHtml}</div>
        <div class="movie-page-info">
          <h1 class="movie-page-title">${escapeHtml(movie.title)} ${badges.join('')}</h1>
          <div class="detail-meta">${metaParts.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>
          ${creditParts.length ? `<div class="movie-page-credits">${creditParts.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>` : ''}
          ${movie.synopsis ? `<p class="detail-synopsis">${escapeHtml(movie.synopsis)}</p>` : ''}
        </div>
      </div>
      <h2 class="showtimes-heading">Showtimes</h2>
      <div class="movie-page-theaters">
        ${theatersHtml || '<div class="empty-detail">No showtimes found today.</div>'}
      </div>
    `;
  }

  // ---- Advertise-with-us mock flow (content -> preview -> payment -> done) ----

  function renderAdvertisePage() {
    let stepHtml;
    if (adState.step === 1) stepHtml = renderAdStep1();
    else if (adState.step === 2) stepHtml = renderAdStep2();
    else if (adState.step === 3) stepHtml = renderAdStep3();
    else stepHtml = renderAdStep4();

    advertisePageEl.innerHTML = `
      <div class="ad-page">
        <h1>Advertise with PDXFlix</h1>
        <p class="ad-intro">Reach Portland moviegoers browsing showtimes. This is a demo flow — no real charge is made and nothing is sent anywhere.</p>
        ${stepHtml}
      </div>
    `;
    bindAdvertiseEvents();
  }

  function renderAdStep1() {
    const previewInner = adState.imageDataUrl
      ? `<img src="${adState.imageDataUrl}" alt="Ad image preview" />`
      : '<span class="ad-image-placeholder">No image selected</span>';

    return `
      <div class="ad-steps">Step 1 of 3 &middot; Create your ad</div>
      <div class="content-card ad-card">
        <label class="ad-field">
          <span>Headline</span>
          <input type="text" id="adHeadline" maxlength="60" placeholder="e.g. Half-price popcorn Mondays" value="${escapeAttr(adState.headline)}" required />
        </label>
        <label class="ad-field">
          <span>Body text</span>
          <textarea id="adBody" maxlength="200" rows="3" placeholder="Tell moviegoers about your offer...">${escapeHtml(adState.description)}</textarea>
        </label>
        <label class="ad-field">
          <span>Image</span>
          <input type="file" id="adImage" accept="image/*" />
        </label>
        <div class="ad-image-preview" id="adImagePreview">${previewInner}</div>
        ${adTheatrePickerHtml()}
        <div class="ad-actions">
          <button type="button" class="btn-primary" id="adNext1">Continue to preview &rarr;</button>
        </div>
      </div>
    `;
  }

  function adTheatrePickerHtml() {
    const all = allTheatreNames();
    const available = all.filter((name) => !adState.theatreNames.includes(name));

    let selectPlaceholder = 'Select a theatre…';
    if (all.length === 0) selectPlaceholder = 'Loading theatres…';
    else if (available.length === 0) selectPlaceholder = 'All theatres added';

    const optionsHtml = available.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');

    const listHtml = adState.theatreNames.length
      ? adState.theatreNames
          .map(
            (name) => `
        <li class="ad-theatre-chip">
          <span>${escapeHtml(name)}</span>
          <button type="button" class="ad-theatre-remove" data-remove-theatre="${escapeAttr(name)}" aria-label="Remove ${escapeAttr(name)}">&times;</button>
        </li>`
          )
          .join('')
      : '<li class="ad-theatre-empty">No theatres selected yet.</li>';

    return `
      <label class="ad-field">
        <span>Theatres showing this ad</span>
        <div class="ad-theatre-add">
          <select id="adTheatreSelect" ${available.length === 0 ? 'disabled' : ''}>
            <option value="">${selectPlaceholder}</option>
            ${optionsHtml}
          </select>
          <button type="button" class="btn-secondary ad-theatre-add-btn" id="adAddTheatre" ${available.length === 0 ? 'disabled' : ''}>+ Add</button>
        </div>
        <div class="ad-field-error" id="adTheatreError" hidden>Select at least one theatre.</div>
      </label>
      <ul class="ad-theatre-list" id="adTheatreList">${listHtml}</ul>
    `;
  }

  function renderAdStep2() {
    const imageInner = adState.imageDataUrl
      ? `<img src="${adState.imageDataUrl}" alt="Ad image" />`
      : '&#127916;';

    return `
      <div class="ad-steps">Step 2 of 3 &middot; Preview</div>
      <div class="content-card ad-card">
        <p class="ad-preview-label">This is roughly how your ad will look on PDXFlix:</p>
        <div class="ad-preview-mock">
          <div class="ad-preview-image">${imageInner}</div>
          <div class="ad-preview-text">
            <div class="ad-preview-headline">${escapeHtml(adState.headline || 'Your headline here')}</div>
            <div class="ad-preview-body">${escapeHtml(adState.description || 'Your ad text here')}</div>
            <span class="ad-preview-tag">Sponsored</span>
          </div>
        </div>
        <p class="ad-preview-theatres">Showing at: ${adState.theatreNames.map(escapeHtml).join(', ')}</p>
        <div class="ad-actions">
          <button type="button" class="btn-secondary" id="adBackTo1">&larr; Edit</button>
          <button type="button" class="btn-primary" id="adNext2">Continue to payment &rarr;</button>
        </div>
      </div>
    `;
  }

  function renderAdStep3() {
    return `
      <div class="ad-steps">Step 3 of 3 &middot; Payment (demo)</div>
      <div class="content-card ad-card">
        <div class="ad-plan">
          <span>1 week featured placement</span>
          <span class="ad-price">${AD_PRICE}</span>
        </div>
        <p class="ad-demo-note">Demo checkout — this form does not process real payments. Any values you enter stay in your browser.</p>
        <label class="ad-field">
          <span>Name on card</span>
          <input type="text" id="adCardName" placeholder="Jane Doe" value="${escapeAttr(adState.cardName)}" required />
        </label>
        <label class="ad-field">
          <span>Card number</span>
          <input type="text" id="adCardNumber" inputmode="numeric" maxlength="19" placeholder="4242 4242 4242 4242" value="${escapeAttr(adState.cardNumber)}" required />
        </label>
        <div class="ad-field-row">
          <label class="ad-field">
            <span>Expiry</span>
            <input type="text" id="adCardExpiry" placeholder="MM/YY" maxlength="5" value="${escapeAttr(adState.cardExpiry)}" required />
          </label>
          <label class="ad-field">
            <span>CVC</span>
            <input type="text" id="adCardCvc" inputmode="numeric" maxlength="4" placeholder="123" value="${escapeAttr(adState.cardCvc)}" required />
          </label>
        </div>
        <div class="ad-actions">
          <button type="button" class="btn-secondary" id="adBackTo2">&larr; Back</button>
          <button type="button" class="btn-primary" id="adPay">Complete purchase &mdash; ${AD_PRICE}</button>
        </div>
      </div>
    `;
  }

  function renderAdStep4() {
    const statsHref = `#/stats/${encodeURIComponent(adState.token || '')}`;
    const statsUrl = `${location.origin}${location.pathname}${statsHref}`;

    return `
      <div class="content-card ad-card ad-confirm">
        <div class="ad-confirm-icon">&#9989;</div>
        <h2>You're all set!</h2>
        <p>Your ad "<strong>${escapeHtml(adState.headline)}</strong>" is scheduled to run.<br>(Demo only — no charge was made.)</p>
        <p class="ad-order-id">Order #DEMO-${escapeHtml(adState.orderId || '')}</p>
        <div class="ad-stats-link-box">
          <div class="ad-stats-link-label">Track impressions &amp; click-throughs here:</div>
          <a href="${escapeAttr(statsHref)}" class="ad-stats-link">${escapeHtml(statsUrl)}</a>
        </div>
        <div class="ad-actions">
          <button type="button" class="btn-secondary" id="adCreateAnother">Create another ad</button>
          <a href="${escapeAttr(statsHref)}" class="btn-primary">View my stats &rarr;</a>
        </div>
      </div>
    `;
  }

  function bindAdvertiseEvents() {
    if (adState.step === 1) {
      advertisePageEl.querySelector('#adHeadline').addEventListener('input', (evt) => {
        adState.headline = evt.target.value;
      });
      advertisePageEl.querySelector('#adBody').addEventListener('input', (evt) => {
        adState.description = evt.target.value;
      });
      advertisePageEl.querySelector('#adImage').addEventListener('change', (evt) => {
        const file = evt.target.files && evt.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          adState.imageDataUrl = reader.result;
          advertisePageEl.querySelector('#adImagePreview').innerHTML =
            `<img src="${adState.imageDataUrl}" alt="Ad image preview" />`;
        };
        reader.readAsDataURL(file);
      });
      advertisePageEl.querySelector('#adAddTheatre').addEventListener('click', () => {
        const select = advertisePageEl.querySelector('#adTheatreSelect');
        const name = select.value;
        if (!name) return;
        if (!adState.theatreNames.includes(name)) adState.theatreNames.push(name);
        advertisePageEl.querySelector('#adTheatreError').hidden = true;
        renderAdvertisePage();
      });
      advertisePageEl.querySelectorAll('[data-remove-theatre]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const name = btn.getAttribute('data-remove-theatre');
          adState.theatreNames = adState.theatreNames.filter((n) => n !== name);
          renderAdvertisePage();
        });
      });
      advertisePageEl.querySelector('#adNext1').addEventListener('click', () => {
        const headlineEl = advertisePageEl.querySelector('#adHeadline');
        if (!adState.headline.trim()) {
          headlineEl.reportValidity();
          return;
        }
        if (adState.theatreNames.length === 0) {
          advertisePageEl.querySelector('#adTheatreError').hidden = false;
          return;
        }
        adState.step = 2;
        renderAdvertisePage();
      });
    } else if (adState.step === 2) {
      advertisePageEl.querySelector('#adBackTo1').addEventListener('click', () => {
        adState.step = 1;
        renderAdvertisePage();
      });
      advertisePageEl.querySelector('#adNext2').addEventListener('click', () => {
        adState.step = 3;
        renderAdvertisePage();
      });
    } else if (adState.step === 3) {
      advertisePageEl.querySelector('#adBackTo2').addEventListener('click', () => {
        adState.step = 2;
        renderAdvertisePage();
      });
      const nameEl = advertisePageEl.querySelector('#adCardName');
      const numberEl = advertisePageEl.querySelector('#adCardNumber');
      const expiryEl = advertisePageEl.querySelector('#adCardExpiry');
      const cvcEl = advertisePageEl.querySelector('#adCardCvc');
      nameEl.addEventListener('input', (e) => { adState.cardName = e.target.value; });
      numberEl.addEventListener('input', (e) => { adState.cardNumber = e.target.value; });
      expiryEl.addEventListener('input', (e) => { adState.cardExpiry = e.target.value; });
      cvcEl.addEventListener('input', (e) => { adState.cardCvc = e.target.value; });

      advertisePageEl.querySelector('#adPay').addEventListener('click', () => {
        for (const el of [nameEl, numberEl, expiryEl, cvcEl]) {
          if (!el.value.trim()) {
            el.reportValidity();
            return;
          }
        }
        adState.orderId = Math.random().toString(36).slice(2, 8).toUpperCase();
        adState.token = getAdvertiserToken();

        // Mock performance numbers, generated once at "purchase" time and
        // persisted -- so the stats page shows the same figures on repeat
        // visits instead of re-rolling them every time.
        const impressions = 1200 + Math.floor(Math.random() * 7400);
        const ctr = 0.01 + Math.random() * 0.04;
        const clicks = Math.max(1, Math.round(impressions * ctr));
        saveAd({
          id: adState.orderId,
          token: adState.token,
          headline: adState.headline,
          description: adState.description,
          imageDataUrl: adState.imageDataUrl,
          theatreNames: adState.theatreNames.slice(),
          purchasedAt: new Date().toISOString(),
          stats: { impressions, clicks },
        });

        adState.step = 4;
        renderAdvertisePage();
      });
    } else {
      advertisePageEl.querySelector('#adCreateAnother').addEventListener('click', () => {
        adState.step = 1;
        adState.headline = '';
        adState.description = '';
        adState.imageDataUrl = null;
        adState.theatreNames = [];
        adState.cardName = '';
        adState.cardNumber = '';
        adState.cardExpiry = '';
        adState.cardCvc = '';
        adState.orderId = null;
        renderAdvertisePage();
      });
    }
  }

  // ---- Ad stats page ----

  function renderStatsPage(token) {
    const ads = loadAds()
      .filter((ad) => ad.token === token)
      .sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt));

    statsPageEl.innerHTML = `
      <div class="ad-page">
        <h1>Your Ad Performance</h1>
        <p class="ad-intro">Impressions and click-throughs for ads purchased with this link. Bookmark this page to check back anytime.</p>
        <div class="content-card">
          <div class="movie-list">
            ${ads.length ? statsRowsHtml(ads) : '<div class="no-results">No ads found for this link.</div>'}
          </div>
        </div>
      </div>
    `;

    statsPageEl.querySelectorAll('[data-toggle-ad]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-toggle-ad');
        state.openAdId = state.openAdId === id ? null : id;
        renderStatsPage(token);
      });
    });
  }

  function statsRowsHtml(ads) {
    return ads
      .map((ad) => {
        const isOpen = ad.id === state.openAdId;
        const purchased = new Date(ad.purchasedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });

        return `
        <div class="movie-row${isOpen ? ' open' : ''}">
          <button class="movie-row-header" data-toggle-ad="${escapeAttr(ad.id)}">
            <span class="title-wrap-outer">
              <span class="title-wrap"><span>${escapeHtml(ad.headline || 'Untitled ad')}</span></span>
              <span class="row-subtitle">Purchased ${purchased} &nbsp;·&nbsp; ${ad.stats.impressions.toLocaleString()} impressions</span>
            </span>
            <span class="chevron">&#9656;</span>
          </button>
          <div class="movie-detail">
            ${isOpen ? renderAdStatsDetail(ad) : ''}
          </div>
        </div>`;
      })
      .join('');
  }

  function renderAdStatsDetail(ad) {
    const ctr = ad.stats.impressions > 0 ? ((ad.stats.clicks / ad.stats.impressions) * 100).toFixed(2) : '0.00';
    const imageInner = ad.imageDataUrl ? `<img src="${ad.imageDataUrl}" alt="Ad image" />` : '&#127916;';

    return `
      <div class="stats-grid">
        <div class="stat-tile">
          <div class="stat-value">${ad.stats.impressions.toLocaleString()}</div>
          <div class="stat-label">Impressions</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${ad.stats.clicks.toLocaleString()}</div>
          <div class="stat-label">Click-throughs</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${ctr}%</div>
          <div class="stat-label">Click-through rate</div>
        </div>
      </div>
      <div class="ad-preview-mock">
        <div class="ad-preview-image">${imageInner}</div>
        <div class="ad-preview-text">
          <div class="ad-preview-headline">${escapeHtml(ad.headline || 'Untitled ad')}</div>
          <div class="ad-preview-body">${escapeHtml(ad.description || '')}</div>
          <span class="ad-preview-tag">Sponsored</span>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.getAttribute('data-filter');
      renderList();
    });
  });

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.getAttribute('data-view');
      applyBodyBackground(state.view);
      renderList();
    });
  });

  searchEl.addEventListener('input', () => {
    state.query = searchEl.value.trim().toLowerCase();
    renderList();
  });

  headerBackBtn.addEventListener('click', goBack);

  window.addEventListener('hashchange', renderRoute);

  fetch('data/movies.json')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      state.meta = data;
      state.movies = data.movies;
      renderMeta();
      renderRoute();
    })
    .catch((err) => {
      listEl.innerHTML = `<div class="no-results">Couldn't load showtimes data (data/movies.json). Run <code>npm run scrape</code> first.<br><small>${escapeHtml(err.message)}</small></div>`;
    });
})();
