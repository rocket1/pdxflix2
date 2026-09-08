(function () {
  const state = {
    movies: [],
    filter: 'all', // 'all' | 'first' | 'second'
    view: 'movies', // 'movies' | 'theatres'
    query: '',
    openSlug: null,
    openTheatre: null,
    meta: null,
  };

  const listEl = document.getElementById('movieList');
  const metaEl = document.getElementById('metaLine');
  const searchEl = document.getElementById('searchInput');
  const filterButtons = Array.from(document.querySelectorAll('#filterToggle button'));
  const viewButtons = Array.from(document.querySelectorAll('#viewToggle button'));

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

  function renderList() {
    const nowMin = portlandNowMinutes();
    if (state.view === 'theatres') {
      renderTheatresView(nowMin);
    } else {
      renderMoviesView(nowMin);
    }
  }

  function renderMoviesView(nowMin) {
    const visible = visibleMovies();

    if (visible.length === 0) {
      listEl.innerHTML = '<div class="no-results">No movies match that search/filter.</div>';
      return;
    }

    listEl.innerHTML = visible
      .map((movie) => {
        const isOpen = movie.slug === state.openSlug;
        const badges = [];
        if (movie.isSecondRun) badges.push('<span class="badge second-run">Second Run</span>');
        if (movie.isClassic) badges.push('<span class="badge classic">Classic</span>');

        return `
        <div class="movie-row${isOpen ? ' open' : ''}" data-slug="${escapeAttr(movie.slug)}">
          <button class="movie-row-header" data-toggle="${escapeAttr(movie.slug)}">
            <span class="title-wrap">
              <span>${escapeHtml(movie.title)}</span>
              ${badges.join('')}
            </span>
            <span class="chevron">&#9656;</span>
          </button>
          <div class="movie-detail">
            ${isOpen ? renderMovieDetail(movie, nowMin) : ''}
          </div>
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = btn.getAttribute('data-toggle');
        state.openSlug = state.openSlug === slug ? null : slug;
        renderList();
      });
    });
  }

  function renderMovieDetail(movie, nowMin) {
    const metaParts = [];
    if (movie.rating) metaParts.push(movie.rating);
    if (movie.runtime) metaParts.push(movie.runtime);
    if (movie.genre) metaParts.push(movie.genre);
    if (movie.releaseDate) {
      const rd = new Date(movie.releaseDate + 'T00:00:00');
      metaParts.push(`Released ${rd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
    }

    const theaters = movie.theaters
      .map((t) => {
        const timesHtml = t.times.map((time) => timeSpanHtml(time, nowMin)).join('');
        return `
        <div class="theater-row">
          <div class="theater-name"><a href="https://www.google.com/search?q=${encodeURIComponent(t.name + ' ' + t.address)}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a></div>
          <div class="times">${timesHtml}</div>
        </div>`;
      })
      .join('');

    return `
      <div class="detail-meta">${metaParts.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>
      ${movie.synopsis ? `<p class="detail-synopsis">${escapeHtml(movie.synopsis)}</p>` : ''}
      ${theaters || '<div class="empty-detail">No showtimes found today.</div>'}
    `;
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
        const slug = link.getAttribute('data-jump-movie');
        state.view = 'movies';
        state.openSlug = slug;
        viewButtons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-view') === 'movies'));
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

    return rows || '<div class="empty-detail">No movies found.</div>';
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

  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      viewButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.getAttribute('data-view');
      renderList();
    });
  });

  searchEl.addEventListener('input', () => {
    state.query = searchEl.value.trim().toLowerCase();
    renderList();
  });

  fetch('data/movies.json')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      state.meta = data;
      state.movies = data.movies;
      renderMeta();
      renderList();
    })
    .catch((err) => {
      listEl.innerHTML = `<div class="no-results">Couldn't load showtimes data (data/movies.json). Run <code>npm run scrape</code> first.<br><small>${escapeHtml(err.message)}</small></div>`;
    });
})();
