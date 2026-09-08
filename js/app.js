(function () {
  const state = {
    movies: [],
    filter: 'all', // 'all' | 'first' | 'second'
    view: 'movies', // 'movies' | 'theatres'
    query: '',
    openTheatre: null,
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
    cardName: '',
    cardNumber: '',
    cardExpiry: '',
    cardCvc: '',
    orderId: null,
  };
  const AD_PRICE = '$99.00';

  const listViewEl = document.getElementById('listView');
  const detailPageEl = document.getElementById('movieDetailPage');
  const advertisePageEl = document.getElementById('advertisePage');
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
    const match = location.hash.match(/^#\/movie\/(.+)$/);
    if (match) return { type: 'movie', slug: decodeURIComponent(match[1]) };
    return { type: 'list' };
  }

  function goToMovie(slug) {
    location.hash = '#/movie/' + encodeURIComponent(slug);
  }

  function renderRoute() {
    const route = parseRoute();

    if (route.type === 'advertise') {
      listViewEl.hidden = true;
      detailPageEl.hidden = true;
      advertisePageEl.hidden = false;
      applyBodyBackground('advertise');
      renderAdvertisePage();
      window.scrollTo(0, 0);
      return;
    }

    if (route.type === 'movie') {
      const movie = state.movies.find((m) => m.slug === route.slug);
      if (movie) {
        listViewEl.hidden = true;
        advertisePageEl.hidden = true;
        detailPageEl.hidden = false;
        applyBodyBackground('detail');
        detailPageEl.innerHTML = renderMovieSubpage(movie, portlandNowMinutes());
        detailPageEl.querySelector('#backLink').addEventListener('click', (evt) => {
          evt.preventDefault();
          location.hash = '';
        });
        window.scrollTo(0, 0);
        return;
      }
    }

    listViewEl.hidden = false;
    detailPageEl.hidden = true;
    advertisePageEl.hidden = true;
    applyBodyBackground(state.view);
    renderList();
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

    return rows || '<div class="empty-detail">No movies found.</div>';
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
      <a href="#" class="back-link" id="backLink">&larr; Back to ${state.view === 'theatres' ? 'Theatres' : 'Movies'}</a>
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
      <a href="#" class="back-link" id="adBack">&larr; Back to PDXFlix</a>
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
        <div class="ad-actions">
          <button type="button" class="btn-primary" id="adNext1">Continue to preview &rarr;</button>
        </div>
      </div>
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
    return `
      <div class="content-card ad-card ad-confirm">
        <div class="ad-confirm-icon">&#9989;</div>
        <h2>You're all set!</h2>
        <p>Your ad "<strong>${escapeHtml(adState.headline)}</strong>" is scheduled to run.<br>(Demo only — no charge was made.)</p>
        <p class="ad-order-id">Order #DEMO-${escapeHtml(adState.orderId || '')}</p>
        <div class="ad-actions">
          <button type="button" class="btn-secondary" id="adCreateAnother">Create another ad</button>
        </div>
      </div>
    `;
  }

  function bindAdvertiseEvents() {
    const back = advertisePageEl.querySelector('#adBack');
    back.addEventListener('click', (evt) => {
      evt.preventDefault();
      location.hash = '';
    });

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
      advertisePageEl.querySelector('#adNext1').addEventListener('click', () => {
        const headlineEl = advertisePageEl.querySelector('#adHeadline');
        if (!adState.headline.trim()) {
          headlineEl.reportValidity();
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
        adState.step = 4;
        renderAdvertisePage();
      });
    } else {
      advertisePageEl.querySelector('#adCreateAnother').addEventListener('click', () => {
        adState.step = 1;
        adState.headline = '';
        adState.description = '';
        adState.imageDataUrl = null;
        adState.cardName = '';
        adState.cardNumber = '';
        adState.cardExpiry = '';
        adState.cardCvc = '';
        adState.orderId = null;
        renderAdvertisePage();
      });
    }
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
