(function () {
  const state = {
    movies: [],
    filter: 'all', // 'all' | 'first' | 'second'
    sort: 'title', // 'title' | 'theater' | 'actor' | 'director'
    query: '',
    openSlug: null,
    meta: null,
  };

  const listEl = document.getElementById('movieList');
  const metaEl = document.getElementById('metaLine');
  const searchEl = document.getElementById('searchInput');
  const sortEl = document.getElementById('sortSelect');
  const filterButtons = Array.from(document.querySelectorAll('.filter-group button'));

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
    const period = h >= 12 ? 'pm' : 'am';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return m === 0 ? `${h12}:00` : `${h12}:${String(m).padStart(2, '0')}`;
  }

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
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

  function primaryTheaterName(movie) {
    if (!movie.theaters || !movie.theaters.length) return null;
    return movie.theaters.map((t) => t.name).sort((a, b) => a.localeCompare(b))[0];
  }

  function primaryActor(movie) {
    return movie.cast && movie.cast.length ? movie.cast[0] : null;
  }

  function primaryDirector(movie) {
    return movie.director || null;
  }

  function sortValue(movie) {
    if (state.sort === 'theater') return primaryTheaterName(movie);
    if (state.sort === 'actor') return primaryActor(movie);
    if (state.sort === 'director') return primaryDirector(movie);
    return movie.title;
  }

  // Sorts by the chosen key; movies missing that key (e.g. no director data
  // without a TMDB key configured) sort to the end, alphabetically by title.
  function sortMovies(movies) {
    return [...movies].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (!av && !bv) return a.title.localeCompare(b.title);
      if (!av) return 1;
      if (!bv) return -1;
      const cmp = av.localeCompare(bv);
      return cmp !== 0 ? cmp : a.title.localeCompare(b.title);
    });
  }

  function rowSubtitle(movie) {
    if (state.sort === 'theater') {
      const name = primaryTheaterName(movie);
      return name ? `Playing at ${name}` : null;
    }
    if (state.sort === 'actor') {
      const name = primaryActor(movie);
      return name ? `Starring ${name}` : null;
    }
    if (state.sort === 'director') {
      const name = primaryDirector(movie);
      return name ? `Directed by ${name}` : 'Director unknown';
    }
    return null;
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
    const visible = sortMovies(state.movies.filter((m) => matchesFilter(m) && matchesQuery(m)));

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
        const subtitle = rowSubtitle(movie);

        return `
        <div class="movie-row${isOpen ? ' open' : ''}" data-slug="${escapeAttr(movie.slug)}">
          <button class="movie-row-header" data-toggle="${escapeAttr(movie.slug)}">
            <span class="title-wrap-outer">
              <span class="title-wrap">
                <span>${escapeHtml(movie.title)}</span>
                ${badges.join('')}
              </span>
              ${subtitle ? `<span class="row-subtitle">${escapeHtml(subtitle)}</span>` : ''}
            </span>
            <span class="chevron">&#9656;</span>
          </button>
          <div class="movie-detail">
            ${isOpen ? renderDetail(movie, nowMin) : ''}
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

  function renderDetail(movie, nowMin) {
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
        const timesHtml = t.times
          .map((time) => {
            const label = to12h(time);
            if (toMinutes(time) < nowMin) {
              return `<span class="time-past">${label}</span>`;
            }
            return `<span class="time-pill">${label}</span>`;
          })
          .join('');
        return `
        <div class="theater-row">
          <div class="theater-name"><a href="https://www.google.com/search?q=${encodeURIComponent(t.name + ' ' + t.address)}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a></div>
          <div class="times">${timesHtml}</div>
        </div>`;
      })
      .join('');

    const creditParts = [];
    if (movie.director) creditParts.push(`Directed by ${movie.director}`);
    if (movie.cast && movie.cast.length) creditParts.push(`Starring ${movie.cast.join(', ')}`);

    return `
      <div class="detail-meta">${metaParts.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>
      ${creditParts.length ? `<div class="detail-credits">${creditParts.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>` : ''}
      ${movie.synopsis ? `<p class="detail-synopsis">${escapeHtml(movie.synopsis)}</p>` : ''}
      ${theaters || '<div class="empty-detail">No showtimes found today.</div>'}
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

  searchEl.addEventListener('input', () => {
    state.query = searchEl.value.trim().toLowerCase();
    renderList();
  });

  sortEl.addEventListener('change', () => {
    state.sort = sortEl.value;
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
