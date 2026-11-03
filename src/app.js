/* ============================================================================
   Polski — one site for the seven cases
   The drill engine, the progress store and every page behaviour.
   Everything is saved on the device in localStorage under "polski.progress.v1".
   ========================================================================== */
(function () {
  'use strict';

  var CAT = window.POLSKI_CATALOG;
  var EX = window.POLSKI_EXTRAS || {};
  if (!CAT) { console.error('catalog missing'); return; }

  var CASES = CAT.cases;
  var CASE_ORDER = CASES.map(function (c) { return c.id; });
  var byId = {};
  CASES.forEach(function (c) { byId[c.id] = c; });

  /* ------------------------------------------------------------------ store */

  var KEY = 'polski.progress.v1';

  function blank() {
    return {
      v: 1,
      items: {},      // itemId -> {box, ok, seen, lastOk, due, ms}
      attempts: 0,
      correct: 0,
      days: {},       // 2026-11-02 -> {n, ok}
      cards: {},      // caseId -> [known words]
      plan: {},       // caseId -> {key: true}
      sets: {}        // caseId/setId -> {best, total, runs}
    };
  }

  var store = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var o = JSON.parse(raw);
      var b = blank();
      for (var k in b) if (!(k in o)) o[k] = b[k];
      o.v = 1;
      return o;
    } catch (e) {
      return blank();
    }
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { flush(); }, 150);
  }
  function flush() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { console.warn('could not save progress', e); }
  }
  window.addEventListener('beforeunload', flush);

  function today(d) {
    d = d || new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return today(d);
  }

  // Right answer moves up a box and waits longer; a miss goes back to the start.
  var WAIT = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

  function itemState(id) {
    return store.items[id] || null;
  }

  function gradeItem(item, ok, ms) {
    var s = store.items[item.id] || { box: 0, ok: 0, seen: 0, streak: 0 };
    var before = s.box || 0;
    s.seen++;
    if (ok) {
      s.box = Math.min(5, before + 1);
      s.streak = (s.streak || 0) + 1;
      s.ok++;
    } else {
      s.box = 1;
      s.streak = 0;
    }
    s.lastOk = ok ? 1 : 0;
    s.due = addDays(today(), WAIT[s.box] || 1);
    s.ms = ms || null;
    store.items[item.id] = s;

    store.attempts++;
    if (ok) store.correct++;
    queueSync();

    var d = today();
    if (!store.days[d]) store.days[d] = { n: 0, ok: 0 };
    store.days[d].n++;
    if (ok) store.days[d].ok++;

    save();
  }

  function bestOf(setKey) {
    return store.sets[setKey] || null;
  }
  function saveBest(setKey, right, total) {
    var b = store.sets[setKey];
    if (!b || right / total > b.best / b.total) {
      store.sets[setKey] = { best: right, total: total, runs: (b ? b.runs : 0) + 1, last: today() };
    } else {
      b.runs++;
      b.last = today();
    }
    save();
  }

  // How well a case is known: items answered right on their last two turns.
  function caseScore(caseId) {
    var c = byId[caseId];
    var known = 0;
    var total = c.count;
    c.sets.forEach(function (set) {
      set.items.forEach(function (it) {
        var s = store.items[it.id];
        if (s && s.box >= 3) known++;
      });
    });
    return { known: known, total: total };
  }

  function dueFor(caseId) {
    var c = byId[caseId];
    var d = today();
    var n = 0;
    c.sets.forEach(function (set) {
      set.items.forEach(function (it) {
        var s = store.items[it.id];
        if (s && s.due && s.due <= d) n++;
      });
    });
    return n;
  }

  function dayStreak() {
    var d = today();
    var n = 0;
    var day = d;
    // today counts only if something was done; otherwise start from yesterday
    if (!store.days[day]) day = addDays(day, -1);
    while (store.days[day] && store.days[day].n > 0) {
      n++;
      day = addDays(day, -1);
    }
    return n;
  }

  /* -------------------------------------------------------------- utilities */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Typed answers: careless punctuation should not cost a point, but
  // Polish diacritics should be noticed — they count, with a warning.
  function norm(s) {
    return String(s).toLowerCase().trim()
      .replace(/[.,!?;:„”"()]/g, '')
      .replace(/\s+/g, ' ');
  }
  function deacc(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
  }

  // Render a question: gaps, the [[word]] form used on two pages, and
  // the "(hint — translation)" parts the pages print after the sentence.
  var WORD_RE = /([A-Za-zÀ-žąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)([^A-Za-zÀ-žąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*)/g;

  function renderQuestion(item) {
    var q = String(item.q || '');
    var out = '';
    var last = 0;
    var m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(q))) {
      out += escapeHtml(q.slice(last, m.index));
      out += '<span class="w">' + escapeHtml(m[1]) + '</span>' + escapeHtml(m[2]);
      last = m.index + m[0].length;
    }
    out += escapeHtml(q.slice(last));
    out = out.replace(/___/g, '<span class="gap"></span>');
    out = out.replace(/\[\[(.*?)\]\]/g, '<span class="gap">$1</span>');
    out = out.replace(/\(\((.*?)\)\)/g, '<span class="tr">($1)</span>');
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Split a question into the part shown in the serif and the bracketed hint.
  function splitHint(q) {
    var m = /^(.*?)\s*\((?:[^()]*)\)\s*$/.exec(String(q));
    return m ? m[1] : q;
  }

  /* ----------------------------------------------------------------- theme */

  function initTheme() {
    var btn = $('#themeBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = cur ? (cur === 'dark' ? 'light' : 'dark') : (sysDark ? 'light' : 'dark');
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('polski.theme', next); } catch (e) {}
    });
  }

  /* ------------------------------------------------------- scroll + nav */

  function initScroll() {
    var bar = $('#scrollbar');
    function onScroll() {
      if (!bar) return;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Build the section nav from the page's own sections: the pages' sections
  // carry no ids for some parts, so headings give the label.
  function initNav() {
    var nav = $('#nav');
    if (!nav) return;
    var main = $('main');
    if (!main) return;
    var links = [];
    $$('section', main).forEach(function (sec) {
      var h2 = $('h2', sec);
      if (!h2) return;
      if (!sec.id) sec.id = 's-' + links.length;
      var a = el('a', null, escapeHtml(h2.textContent.trim()));
      a.href = '#' + sec.id;
      nav.appendChild(a);
      links.push(a);
    });
    if (!links.length) { nav.style.display = 'none'; return; }

    var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            links.forEach(function (l) {
              l.classList.toggle('on', l.getAttribute('href') === '#' + e.target.id);
            });
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      targets.forEach(function (t) { io.observe(t); });
    }
  }

  function initCaseSwitch() {
    var sw = $('[data-caseswitch]');
    if (!sw) return;
    var btn = $('button', sw);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = sw.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function () {
      sw.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        sw.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------------------------------------------------------- drill engine */

  var activeRun = null;

  // A run is a list of items from one or more sets, in order.
  function makeRun(opts) {
    var st = {
      title: opts.title,
      ask: opts.ask,
      setKey: opts.setKey,
      items: opts.items,
      i: 0,
      right: 0,
      misses: [],
      answered: false,
      startedAt: Date.now(),
      onDone: opts.onDone
    };
    return st;
  }

  function mountRunner(root, run) {
    activeRun = run;
    root.innerHTML = '';

    var wrap = el('div', 'runner on');
    wrap.innerHTML =
      '<div class="rhead">' +
        '<span class="ttl"></span>' +
        '<span class="cnt"></span>' +
        '<span class="sp"></span>' +
        '<span class="score"></span>' +
        '<button class="xbtn" data-quit>Change set</button>' +
      '</div>' +
      '<div class="pbar"><i></i></div>' +
      '<div class="ask"></div>' +
      '<p class="qsay"></p>' +
      '<p class="q"></p>' +
      '<p class="qhint"></p>' +
      '<div class="opts"></div>' +
      '<div class="typebox" style="display:none">' +
        '<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your answer">' +
        '<button class="btn primary" data-check>Check</button>' +
      '</div>' +
      '<div class="fb" aria-live="polite"></div>' +
      '<div class="rfoot">' +
        '<button class="btn primary" data-next disabled>Next</button>' +
        '<span class="sp"></span>' +
        '<button class="xbtn" data-skip>Skip?</button>' +
      '</div>';
    root.appendChild(wrap);

    var q = {
      ttl: $('.ttl', wrap),
      cnt: $('.cnt', wrap),
      score: $('.score', wrap),
      fill: $('.pbar i', wrap),
      ask: $('.ask', wrap),
      say: $('.qsay', wrap),
      text: $('.q', wrap),
      hint: $('.qhint', wrap),
      opts: $('.opts', wrap),
      typebox: $('.typebox', wrap),
      input: $('input', wrap),
      check: $('[data-check]', wrap),
      fb: $('.fb', wrap),
      next: $('[data-next]', wrap),
      skip: $('[data-skip]', wrap),
      quit: $('[data-quit]', wrap)
    };

    q.ttl.textContent = run.title;
    q.ask.textContent = run.ask || '';
    q.quit.style.display = run.onDone ? '' : 'none';
    q.quit.textContent = 'Back';

    var shownAt = Date.now();

    function render() {
      var item = run.items[run.i];
      run.answered = false;
      shownAt = Date.now();
      q.fb.className = 'fb';
      q.fb.innerHTML = '';
      q.next.disabled = true;
      q.next.textContent = run.i + 1 >= run.items.length ? 'Finish' : 'Next';
      q.skip.style.display = '';
      q.input.classList.remove('right', 'wrong');
      q.input.value = '';
      q.input.disabled = false;
      q.check.disabled = false;

      q.cnt.textContent = (run.i + 1) + ' / ' + run.items.length;
      q.score.textContent = run.right + ' correct';
      q.fill.style.width = (run.i / run.items.length * 100) + '%';
      q.hint.textContent = item.hint ? 'Hint: ' + item.hint : '';
      var say = item.ask || '';
      if (sameWords(say, run.ask || '')) say = '';
      q.say.textContent = say;
      q.say.style.display = say ? '' : 'none';
      if (!q.hint.textContent || sameWords(item.hint || '', say) || sameWords(item.hint || '', run.ask || '')) {
        q.hint.textContent = '';
      }

      if (item.kind === 'choice') {
        q.text.innerHTML = renderQuestion(item);
        q.typebox.style.display = 'none';
        q.opts.style.display = 'grid';
        q.opts.innerHTML = '';
        shuffle(item.opts.slice()).forEach(function (o, i) {
          var b = el('button', 'opt',
            '<span class="k">' + (i + 1) + '</span><span>' + escapeHtml(o) + '</span>');
          b.dataset.val = o;
          b.addEventListener('click', function () { pick(b, item); });
          q.opts.appendChild(b);
        });
      } else {
        q.text.innerHTML = renderQuestion(item);
        q.opts.style.display = 'none';
        q.typebox.style.display = 'flex';
        setTimeout(function () { q.input.focus(); }, 40);
      }
    }

    function markChoices(item) {
      $$('.opt', q.opts).forEach(function (b) {
        b.disabled = true;
        if (b.dataset.val === item.a) b.classList.add('right');
      });
    }

    function pick(btn, item) {
      if (btn.disabled) return;
      var ok = btn.dataset.val === item.a;
      if (!ok) btn.classList.add('wrong');
      markChoices(item);
      finish(ok, item.a, item, false);
    }

    function checkTyped() {
      var item = run.items[run.i];
      var val = q.input.value;
      if (!val.trim()) { q.input.focus(); return; }
      var n = norm(val);
      var ok = false;
      var accentOnly = false;
      (item.accept || []).forEach(function (c) {
        if (n === norm(c)) ok = true;
        else if (deacc(n) === deacc(norm(c))) accentOnly = true;
      });
      q.input.disabled = true;
      q.check.disabled = true;
      q.input.classList.add(ok || accentOnly ? 'right' : 'wrong');
      finish(ok, (item.accept || []).join(' · '), item, accentOnly);
    }

    function finish(ok, correct, item, accentOnly) {
      if (run.answered) return;
      run.answered = true;
      var ms = Date.now() - shownAt;
      if (ok) run.right++;
      else run.misses.push(run.i);
      gradeItem(item, ok, ms);
      q.score.textContent = run.right + ' correct';

      q.fb.className = 'fb on ' + (ok ? 'ok' : 'no');
      var head = ok ? (accentOnly ? 'Right — mind the diacritics' : 'Correct') : (accentOnly ? 'Nearly — the diacritics count' : 'Not quite');
      q.fb.innerHTML =
        '<div class="v">' + head + '</div>' +
        (ok ? '' : '<div class="a">' + escapeHtml(correct) + '</div>') +
        '<div class="why">' + (item.why || '') + '</div>';

      q.next.disabled = false;
      q.skip.style.display = 'none';
      updateMeters();
      q.next.focus();
    }

    function next() {
      if (run.i + 1 >= run.items.length) { end(); return; }
      run.i++;
      render();
    }

    function end() {
      if (run.setKey) saveBest(run.setKey, run.right, run.items.length);
      var total = run.items.length;
      var pct = Math.round(run.right / total * 100);
      var msg;
      if (pct === 100) msg = 'Clean sweep. Move to the next set, or come back tomorrow — spacing is what makes this stick.';
      else if (pct >= 80) msg = 'Solid. Reread the explanations for the ones you missed, then run them again.';
      else if (pct >= 50) msg = 'The pattern is there but not automatic yet. Run the mistakes again now, and the whole set tomorrow.';
      else msg = 'Go back to the section for this set, read the table once more, then retry. Nothing here needs to be memorised blind.';

      var sum = el('div', 'summary on');
      sum.innerHTML = '<div class="big">' + run.right + ' / ' + total + '</div><p>' + msg + '</p>';
      var cta = el('div', 'cta');
      cta.style.justifyContent = 'center';

      if (run.misses.length) {
        var again = el('button', 'btn primary', 'Review ' + run.misses.length + ' mistake' + (run.misses.length > 1 ? 's' : ''));
        again.addEventListener('click', function () {
          var items = run.misses.map(function (i) { return run.items[i]; });
          mountRunner(root, makeRun({
            title: run.title + ' — mistakes',
            ask: 'Reviewing your mistakes',
            setKey: run.setKey,
            items: items,
            onDone: run.onDone
          }));
        });
        cta.appendChild(again);
      }
      var rerun = el('button', 'btn ghost', 'Run it again');
      rerun.addEventListener('click', function () {
        mountRunner(root, makeRun({
          title: run.title,
          ask: run.ask,
          setKey: run.setKey,
          items: shuffle(run.items.slice()),
          onDone: run.onDone
        }));
      });
      cta.appendChild(rerun);

      if (run.onDone) {
        var back = el('button', 'btn ghost', 'Back');
        back.addEventListener('click', function () { run.onDone(); });
        cta.appendChild(back);
      }
      sum.appendChild(cta);
      root.innerHTML = '';
      root.appendChild(sum);
      updateMeters();
    }

    q.next.addEventListener('click', next);
    q.check.addEventListener('click', checkTyped);
    q.quit.addEventListener('click', function () {
      if (run.onDone) run.onDone();
      else root.innerHTML = '';
      activeRun = null;
    });
    q.skip.addEventListener('click', function () {
      var item = run.items[run.i];
      if (item.kind === 'choice') markChoices(item);
      else {
        q.input.value = (item.accept || [])[0] || '';
        q.input.disabled = true;
        q.check.disabled = true;
        q.input.classList.add('wrong');
      }
      finish(false, (item.accept || []).length ? item.accept[0] : item.a, item, false);
    });
    q.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (q.input.disabled) next(); else checkTyped();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (!document.body.contains(wrap)) return;
      if (e.target === q.input) return;
      var item = run.items[run.i];
      if (!item) return;
      if (item.kind === 'choice' && e.key >= '1' && e.key <= '9') {
        var b = q.opts.children[Number(e.key) - 1];
        if (b && !b.disabled) b.click();
      }
      if (e.key === 'Enter' && !q.next.disabled) {
        e.preventDefault();
        next();
      }
    });

    render();
  }

  /* --------------------------------------------------------- case drill UI */

  function initCaseDrills() {
    var root = $('#drillRoot');
    if (!root) return;
    var caseId = root.dataset.case;
    var c = byId[caseId];
    if (!c) return;

    function grid() {
      activeRun = null;
      root.innerHTML = '';
      var box = el('div', 'drills');
      var head = el('div', 'chips');
      var sc = caseScore(caseId);
      head.innerHTML = '<span class="chip">' + c.sets.length + ' sets · ' + c.count + ' items</span>';
      box.appendChild(head);

      var g = el('div', 'setgrid');
      c.sets.forEach(function (set) {
        var key = caseId + '/' + set.id;
        var b = bestOf(key);
        var btn = el('button', 'setcard',
          '<div class="t">' + escapeHtml(set.title) + '</div>' +
          '<div class="m">' + set.items.length + ' items</div>' +
          (b ? '<div class="best">best ' + b.best + ' / ' + b.total + ' · ' + b.runs + ' run' + (b.runs > 1 ? 's' : '') + '</div>' : ''));
        btn.addEventListener('click', function () {
          mountRunner(root, makeRun({
            title: set.title,
            ask: set.ask,
            setKey: key,
            items: shuffle(set.items.slice()),
            onDone: grid
          }));
        });
        g.appendChild(btn);
      });
      box.appendChild(g);

      var cta = el('div', 'cta');
      cta.style.marginTop = '16px';
      var due = dueFor(caseId);
      if (due > 0) {
        var rd = el('button', 'btn primary', 'Review the ' + due + ' due');
        rd.addEventListener('click', function () {
          var items = [];
          c.sets.forEach(function (set) {
            set.items.forEach(function (it) {
              var s = store.items[it.id];
              if (s && s.due && s.due <= today()) items.push(it);
            });
          });
          mountRunner(root, makeRun({
            title: c.pl + ' — due for review',
            ask: 'What the schedule says you owe',
            setKey: null,
            items: shuffle(items).slice(0, 30),
            onDone: grid
          }));
        });
        cta.appendChild(rd);
      }
      var all = el('button', 'btn ghost', 'Drill all ' + c.count);
      all.addEventListener('click', function () {
        var items = [];
        c.sets.forEach(function (set) { items = items.concat(set.items); });
        mountRunner(root, makeRun({
          title: c.pl + ' — all items',
          ask: 'Every item in the case, shuffled',
          setKey: null,
          items: shuffle(items),
          onDone: grid
        }));
      });
      cta.appendChild(all);
      box.appendChild(cta);
      root.appendChild(box);
    }

    grid();
  }

  /* ------------------------------------------------------------- reference */

  function initReference() {
    var body = $('#refBody');
    if (!body) return;
    var caseId = body.dataset.case;
    var ex = EX[caseId] && EX[caseId].ref;
    if (!ex) return;
    var input = $('#refFilter');
    var count = $('#refCount');

    function rowHtml(r) {
      switch (ex.mode) {
        case 'bold4': // nominative: gender in bold, then the note
          return '<td class="pl">' + r[0] + '</td><td class="pl">' + r[1] +
            '</td><td class="small"><b>' + r[2] + '</b></td><td class="small">' + r[3] + '</td>';
        case 'plain4': // genitive, accusative: four plain columns
          return '<td class="pl">' + r[0] + '</td><td class="pl">' + r[1] + '</td><td class="pl">' + r[2] +
            '</td><td class="small">' + r[3] + '</td>';
        case 'plain3': // accusative's own three-part layout, kept for safety
          return '<td class="pl">' + r[0] + '</td><td class="pl">' + r[1] + '</td><td class="pl">' + r[2] +
            '</td><td class="small">' + (r[3] || '') + '</td>';
        case 'merge3': // vocative: type and rule in one cell
          return '<td class="pl">' + r[0] + '</td><td class="pl">' + r[1] +
            '</td><td class="small"><b>' + r[2] + '</b> · ' + (r[3] || '') + '</td>';
        default: // locative: objects
          return '<td class="pl">' + r.a + '</td><td class="pl">' + r.s + '</td><td class="pl">' + r.p +
            '</td><td class="small">' + r.g + ' — ' + r.why + '</td>';
      }
    }
    function haystack(r) {
      return (Array.isArray(r) ? r.join(' ') : [r.a, r.s, r.p, r.g, r.why].join(' ')).toLowerCase();
    }

    function render() {
      var q = (input.value || '').toLowerCase().trim();
      var html = '';
      var n = 0;
      ex.rows.forEach(function (r) {
        if (q && haystack(r).indexOf(q) === -1) return;
        n++;
        html += '<tr>' + rowHtml(r) + '</tr>';
      });
      body.innerHTML = html;
      count.textContent = n + ' of ' + ex.rows.length;
    }
    input.addEventListener('input', render);
    render();
  }

  /* ------------------------------------------------------------- flashcards */

  function initCards() {
    var grid = $('#fcGrid');
    if (!grid) return;
    var caseId = grid.dataset.case;
    var cards = (EX[caseId] && EX[caseId].cards) || [];
    var knownEl = $('#fcKnown');
    var totalEl = $('#fcTotal');
    var filter = 'all';
    var label = grid.dataset.knownLabel || 'Known';

    function knownSet() {
      return store.cards[caseId] || [];
    }
    function render() {
      var known = knownSet();
      var html = '';
      cards.forEach(function (c) {
        if (filter !== 'all' && c.lv !== filter) return;
        var isKnown = known.indexOf(c.p) !== -1;
        html += '<div class="fc' + (isKnown ? ' known' : '') + '" data-p="' + escapeHtml(c.p) + '">' +
          '<span class="lv">' + (c.lv === 'basic' ? 'basic' : 'advanced') + '</span>' +
          '<div class="p">' + c.p + '</div>' +
          '<div class="hint">click to turn over</div>' +
          '<div class="m">' + c.m + '</div>' +
          '<div class="exm">' + c.ex + '</div>' +
          '<div class="fcbtns"><button data-yes>✔ ' + (caseId === 'instrumental' ? 'Umiem' : 'I know it') +
          '</button><button data-no>↻ ' + (caseId === 'instrumental' ? 'Powtórzę' : 'Again') + '</button></div>' +
        '</div>';
      });
      grid.innerHTML = html;
      $$('.fc', grid).forEach(function (card) {
        card.addEventListener('click', function (ev) {
          var t = ev.target;
          if (t.hasAttribute && (t.hasAttribute('data-yes') || t.hasAttribute('data-no'))) {
            var set = knownSet();
            var p = card.getAttribute('data-p');
            if (t.hasAttribute('data-yes')) {
              if (set.indexOf(p) === -1) set.push(p);
            } else {
              var ix = set.indexOf(p);
              if (ix !== -1) set.splice(ix, 1);
            }
            store.cards[caseId] = set;
            save();
            queueSync();
            render();
            return;
          }
          card.classList.toggle('flipped');
        });
      });
      if (knownEl) knownEl.textContent = known.length;
      if (totalEl) totalEl.textContent = cards.length;
      updateMeters();
    }
    $$('#fcFilters button').forEach(function (chip) {
      chip.addEventListener('click', function () {
        $$('#fcFilters button').forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
        filter = chip.dataset.fclv;
        render();
      });
    });
    render();
  }

  /* ------------------------------------------------------------------ plan */

  function initPlan() {
    var root = $('#planRoot');
    if (!root) return;
    var caseId = root.dataset.case;
    var plan = (EX[caseId] && EX[caseId].plan) || [];
    var saved = store.plan[caseId] || {};
    var html = '';
    plan.forEach(function (day) {
      html += '<div class="plan-day"><div class="dt">' + day.t + '</div>';
      day.items.forEach(function (it) {
        html += '<label><input type="checkbox" data-k="' + it.k + '"' + (saved[it.k] ? ' checked' : '') +
          '><span>' + it.en + '</span></label>';
      });
      html += '</div>';
    });
    root.innerHTML = html;
    $$('input[type=checkbox]', root).forEach(function (box) {
      box.addEventListener('change', function () {
        var s = store.plan[caseId] || {};
        s[box.dataset.k] = box.checked;
        store.plan[caseId] = s;
        save();
        queueSync();
        updateMeters();
      });
    });
  }

  /* ------------------------------------------------------------ verb tables */

  function initVerbs() {
    var body = $('#verbBody');
    if (!body) return;
    var caseId = body.dataset.case;
    var verbs = (EX[caseId] && EX[caseId].verbs) || [];
    var input = $('#verbSearch');
    var count = $('#verbCount');
    var chips = $$('#verbChips button');
    var filter = 'all';

    function render() {
      var q = (input.value || '').toLowerCase().trim();
      var html = '';
      var n = 0;
      verbs.forEach(function (v) {
        if (filter !== 'all' && v.f !== filter && v.lv !== filter) return;
        var hay = [v.v, v.en, v.pat, v.ex, v.c].join(' ').toLowerCase();
        if (q && hay.indexOf(q) === -1) return;
        n++;
        if (v.c) {
          html += '<tr><td class="pl">' + v.v + '</td><td class="small">' + v.c + '</td><td class="small">' + v.en +
            '</td><td class="pl">' + v.ex + '</td></tr>';
        } else {
          html += '<tr><td class="pl">' + v.v + '</td><td class="small">' + v.en + '</td><td class="small">' + v.pat +
            '</td><td class="pl">' + v.ex + '</td></tr>';
        }
      });
      body.innerHTML = html;
      if (count) count.textContent = n + ' of ' + verbs.length;
    }
    input.addEventListener('input', render);
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
        filter = chip.dataset.vf || chip.dataset.verbfilter;
        render();
      });
    });
    render();
  }

  /* --------------------------------------------------------- today + mixed */

  // True when two short texts say the same thing, so a line is not shown twice.
  function sameWords(a, b) {
    function norm(s) {
      return String(s || '').toLowerCase().replace(/[^a-ząćęłńóśźż0-9]+/gi, ' ').trim();
    }
    var x = norm(a), y = norm(b);
    return !!x && x === y;
  }

  function allItems(caseId) {
    var c = byId[caseId];
    var out = [];
    c.sets.forEach(function (s) {
      s.items.forEach(function (it) {
        // Mixed runs pull items out of their set, so each one keeps the set's
        // instruction — without it a lone word like "dobry" says nothing.
        var copy = {};
        for (var k in it) copy[k] = it[k];
        copy.ask = it.ask || s.ask;
        copy.setTitle = s.title;
        out.push(copy);
      });
    });
    return out;
  }

  function dueItems() {
    var out = [];
    CASE_ORDER.forEach(function (id) {
      byId[id].sets.forEach(function (set) {
        set.items.forEach(function (it) {
          var s = store.items[it.id];
          if (s && s.due && s.due <= today()) out.push(it);
        });
      });
    });
    return out;
  }

  // The case in focus: the first case that is not yet comfortably known.
  function focusCase() {
    for (var i = 0; i < CASE_ORDER.length; i++) {
      var id = CASE_ORDER[i];
      var sc = caseScore(id);
      if (sc.known < sc.total * 0.6) return id;
    }
    return CASE_ORDER[0];
  }

  function initToday() {
    var root = $('#todayRoot');
    if (!root) return;
    var focus = focusCase();
    var c = byId[focus];
    var due = shuffle(dueItems()).slice(0, 8);
    var seen = {};
    due.forEach(function (i) { seen[i.id] = 1; });

    var fresh = shuffle(allItems(focus).filter(function (i) { return !seen[i.id]; }));
    var picks = due.concat(fresh.slice(0, Math.max(0, 12 - due.length)));
    shuffle(picks);

    var sc = caseScore(focus);
    root.innerHTML =
      '<div class="chips">' +
        '<span class="chip">Case in focus: <b>' + c.pl + '</b></span>' +
        '<span class="chip">Known: <b>' + sc.known + ' / ' + sc.total + '</b></span>' +
        '<span class="chip">Review first: <b>' + due.length + '</b></span>' +
        '<span class="chip">' + today() + '</span>' +
      '</div>';

    var box = el('div');
    box.style.marginTop = '16px';
    var start = el('button', 'btn primary', 'Start the ' + picks.length + ' items');
    start.addEventListener('click', function () {
      mountRunner(root, makeRun({
        title: 'Today · ' + c.pl,
        ask: 'Twelve items, review first',
        setKey: null,
        items: picks,
        onDone: function () { location.reload(); }
      }));
    });
    box.appendChild(start);
    root.appendChild(box);
  }

  function initMixed() {
    var root = $('#mixedRoot');
    if (!root) return;
    var btn = $('#mixedStart');
    function run(n) {
      var due = shuffle(dueItems()).slice(0, Math.floor(n / 2));
      var rest = [];
      due.forEach(function (i) { rest.push(i.id); });
      var pool = [];
      CASE_ORDER.forEach(function (id) {
        allItems(id).forEach(function (it) { if (rest.indexOf(it.id) === -1) pool.push(it); });
      });
      var picks = due.concat(shuffle(pool).slice(0, n - due.length));
      mountRunner(root, makeRun({
        title: 'Mixed · all seven cases',
        ask: 'Review first, then random',
        setKey: null,
        items: shuffle(picks),
        onDone: function () { location.reload(); }
      }));
    }
    btn.addEventListener('click', function () { run(20); });
  }

  /* -------------------------------------------------------------- progress */

  function initProgress() {
    var root = $('#progressRoot');
    if (!root) return;

    var totalDrills = 0;
    CASE_ORDER.forEach(function (id) { totalDrills += byId[id].count; });

    var stats = '<div class="stats">' +
      '<div class="stat"><div class="v">' + store.attempts + '</div><div class="l">drills answered</div></div>' +
      '<div class="stat"><div class="v">' + (store.attempts ? Math.round(store.correct / store.attempts * 100) + '%' : '—') + '</div><div class="l">correct</div></div>' +
      '<div class="stat"><div class="v">' + dayStreak() + '</div><div class="l">day streak</div></div>' +
      '<div class="stat"><div class="v">' + dueItems().length + '</div><div class="l">due for review</div></div>' +
    '</div>';

    var rows = CASE_ORDER.map(function (id) {
      var c = byId[id];
      var sc = caseScore(id);
      var pct = Math.round(sc.known / sc.total * 100);
      return '<tr>' +
        '<td><a href="/' + id + '/">' + c.pl + '</a></td>' +
        '<td class="small">' + c.en + '</td>' +
        '<td class="small">' + sc.known + ' / ' + sc.total + '</td>' +
        '<td style="min-width:160px"><div class="bar" style="height:6px;border-radius:99px;background:var(--line2);overflow:hidden"><i style="display:block;height:100%;width:' + pct + '%;background:var(--green)"></i></div></td>' +
        '<td class="small">' + dueFor(id) + '</td>' +
        '<td><a class="small" href="/' + id + '/#drills">Drill</a></td>' +
      '</tr>';
    }).join('');

    root.innerHTML = stats +
      '<div class="tw"><table><thead><tr><th>Case</th><th>Polish name</th><th>Known</th><th></th><th>Due</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="small">“Known” counts items you answered correctly at least twice in a row — item 3 or higher in the schedule.</p>';

    var due = dueItems();
    var dueRoot = $('#dueRoot');
    if (dueRoot) {
      if (!due.length) {
        dueRoot.innerHTML = '<p>Nothing is due. Start a new set, or come back tomorrow — the schedule will fill up.</p>';
      } else {
        var list = due.slice(0, 12).map(function (it) {
          return '<li>' + escapeHtml(splitHint(it.q)) + (it.hint ? ' <span class="small">— ' + escapeHtml(it.hint) + '</span>' : '') + '</li>';
        }).join('');
        dueRoot.innerHTML = '<p>' + due.length + ' items are due. The oldest of them:</p><ul>' + list + '</ul>';
      }
    }

    var reset = $('#resetProgress');
    if (reset) reset.addEventListener('click', function () {
      if (!reset.dataset.sure) {
        reset.dataset.sure = '1';
        reset.textContent = 'Press again to clear everything';
        setTimeout(function () {
          if (reset.dataset.sure) {
            delete reset.dataset.sure;
            reset.textContent = 'Clear all progress';
          }
        }, 5000);
        return;
      }
      store = blank();
      flush();
      queueSync();
      location.reload();
    });
  }

  /* ------------------------------------------------------------------ sync */

  // Progress follows you between devices through one small API on Cloudflare.
  // The device keeps its own copy first, so nothing is lost when the network
  // or the database is missing; the code below is the only key to it.
  var SYNC_KEY = 'polski.sync.v1';

  function syncState() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function setSyncState(s) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) {}
  }

  var syncTimer = null;
  var syncBusy = false;

  function syncPush() {
    var s = syncState();
    if (!s.code || syncBusy) return;
    syncBusy = true;
    // A millisecond stamp, always larger than what this device has seen.
    var rev = Math.max(Date.now(), (s.rev || 0) + 1);
    apiFetch('/api/progress/' + s.code, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rev: rev, data: store })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok) {
          setSyncState({ code: s.code, rev: res.j.rev || rev, at: new Date().toISOString(), error: null });
        } else {
          setSyncState({ code: s.code, rev: s.rev || 0, at: s.at, error: res.j.error || 'save failed' });
        }
      })
      .catch(function (e) {
        setSyncState({ code: s.code, rev: s.rev || 0, at: s.at, error: e && e.message ? e.message : 'offline' });
      })
      .then(function () {
        syncBusy = false;
        paintSync();
      });
  }

  function queueSync() {
    if (!syncState().code) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncPush, 1200);
  }

  // Every sync call goes through here: a site without the API (a plain static
  // server, or Pages before the D1 binding exists) answers with HTML, not JSON.
  function apiFetch(url, opts) {
    return fetch(url, opts).then(function (r) {
      var type = r.headers.get('content-type') || '';
      if (type.indexOf('application/json') === -1) {
        throw new Error('Syncing is not available on this copy of the site — it needs the Cloudflare build with the database. Your progress is still saved in this browser.');
      }
      return r;
    }, function () {
      throw new Error('Syncing could not reach the server. Check your connection — your progress is still saved in this browser.');
    });
  }

  function syncPull(code) {
    return apiFetch('/api/progress/' + code)
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('server said ' + r.status);
        return r.json();
      });
  }

  // Adopt the server's copy only when it is genuinely newer than this device's,
  // so a page never reloads on data it already has.
  function adopt(remote) {
    var local = syncState().rev || 0;
    if (remote && remote.rev > local && remote.data && remote.data.v === 1) {
      store = remote.data;
      var b = blank();
      for (var k in b) if (!(k in store)) store[k] = b[k];
      flush();
      setSyncState({ code: syncState().code, rev: remote.rev, at: remote.updatedAt, error: null });
      return true;
    }
    return false;
  }

  function startSync() {
    return apiFetch('/api/progress')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.code) throw new Error('sync is not set up on this site');
        setSyncState({ code: j.code, rev: 0, at: null, error: null });
        return syncPush();
      });
  }

  function joinSync(code) {
    code = String(code || '').trim().toLowerCase().replace(/[\s-]/g, '');
    // 12-character codes are current; 32-character codes from before keep working.
    if (!/^[a-f0-9]{12}([a-f0-9]{20})?$/.test(code)) throw new Error('that is not a sync code');
    var s = syncState();
    setSyncState({ code: code, rev: 0, at: s.at, error: null });
    return syncPull(code).then(function (remote) {
      if (remote) {
        if (adopt(remote)) return 'pulled';
        return syncPush(); // this device knows more; send it up
      }
      return syncPush();
    });
  }

  // Codes are stored without spaces; 12-character ones read better as
  // `xxxx xxxx xxxx`. Older 32-character codes are shown as they are.
  function formatCode(code) {
    return /^[a-f0-9]{12}$/.test(code) ? code.replace(/(.{4})/g, '$1 ').trim() : code;
  }

  function paintSync() {
    var root = $('#syncRoot');
    if (!root) return;
    var s = syncState();
    var out = '';
    if (!s.code) {
      out =
        '<p>Progress is saved on this device now. Give it a sync code and it follows you to your phone and back.</p>' +
        '<div class="cta"><button class="btn primary" id="syncNew">Create a sync code</button>' +
        '<button class="btn ghost" id="syncJoin">I have a code</button></div>' +
        '<div id="syncJoinBox" style="display:none;margin-top:12px">' +
        '<div class="typebox"><input id="syncCodeIn" type="text" placeholder="type or paste your sync code" ' +
        'autocomplete="off" spellcheck="false"><button class="btn primary" id="syncJoinGo">Use it</button></div>' +
        '</div><p class="small" id="syncMsg"></p>';
    } else {
      out =
        '<p>This device syncs with the code below. Type the same code on another device to carry your progress over.</p>' +
        '<div class="chips"><span class="chip">Sync code: <b style="font-family:var(--mono);font-size:12.5px">' +
        formatCode(s.code) + '</b></span>' +
        '<span class="chip">' + (s.at ? 'last saved ' + s.at.slice(0, 16).replace('T', ' ') : 'not saved yet') + '</span>' +
        (s.error ? '<span class="chip">⚠ ' + s.error + '</span>' : '') +
        '</div>' +
        '<div class="cta"><button class="btn ghost" id="syncCopy">Copy the code</button>' +
        '<button class="btn ghost" id="syncNow">Save now</button>' +
        '<button class="btn ghost" id="syncForget">Stop syncing on this device</button></div>' +
        '<p class="small" id="syncMsg">Anyone with the code can read and change this progress — keep it to yourself.</p>';
    }
    root.innerHTML = out;

    var msg = function (t) { var m = $('#syncMsg'); if (m) m.textContent = t; };

    var n = $('#syncNew');
    if (n) n.addEventListener('click', function () {
      n.disabled = true;
      startSync().then(function () { paintSync(); }).catch(function (e) { msg(String(e.message || e)); });
    });
    var j = $('#syncJoin');
    if (j) j.addEventListener('click', function () {
      var box = $('#syncJoinBox');
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
    var go = $('#syncJoinGo');
    if (go) go.addEventListener('click', function () {
      var code = $('#syncCodeIn').value;
      go.disabled = true;
      joinSync(code)
        .then(function (what) {
          var m0 = $('#syncMsg');
          if (what === 'pulled') {
            if (m0) m0.textContent = 'Progress brought over from your other device.';
            setTimeout(function () { location.reload(); }, 700);
          } else {
            paintSync();
            var m = $('#syncMsg');
            if (m) m.textContent = 'This device is now linked; its progress was sent up.';
          }
        })
        .catch(function (e) {
          go.disabled = false;
          msg(String(e.message || e));
        });
    });
    var c = $('#syncCopy');
    if (c) c.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(formatCode(s.code)).then(function () { msg('Copied.'); });
      else msg(s.code);
    });
    var now = $('#syncNow');
    if (now) now.addEventListener('click', function () { syncPush(); });
    var f = $('#syncForget');
    if (f) f.addEventListener('click', function () {
      // Two presses, no browser dialog: the first asks, the second does it.
      if (!f.dataset.sure) {
        f.dataset.sure = '1';
        f.textContent = 'Press again to stop syncing here';
        setTimeout(function () {
          if (f.dataset.sure) {
            delete f.dataset.sure;
            f.textContent = 'Stop syncing on this device';
          }
        }, 5000);
        return;
      }
      setSyncState({});
      paintSync();
    });
  }

  function initSync() {
    // On a page with the panel, offer the state; on any page, pull quietly.
    var s = syncState();
    if (s.code) {
      syncPull(s.code)
        .then(function (remote) { if (adopt(remote)) location.reload(); })
        .catch(function () {});
    }
    paintSync();
  }

  /* --------------------------------------------------------------- meters */

  function updateMeters() {
    // Hub cards
    $$('[data-case-card]').forEach(function (card) {
      var id = card.dataset.caseCard;
      var sc = caseScore(id);
      var pct = Math.round(sc.known / sc.total * 100);
      var bar = $('[data-case-bar]', card);
      var lbl = $('[data-case-lbl]', card);
      if (bar) bar.style.width = pct + '%';
      if (lbl) lbl.textContent = sc.known ? pct + '% known' : 'not started';
    });
    // Hub stats
    var drills = $('[data-stat="drills"]');
    if (drills) {
      $('[data-stat="drills"]').textContent = store.attempts;
      $('[data-stat="acc"]').textContent = store.attempts ? Math.round(store.correct / store.attempts * 100) + '%' : '—';
      $('[data-stat="due"]').textContent = dueItems().length;
      $('[data-stat="day"]').textContent = dayStreak();
    }
    // Case page chips
    var dp = $('#drillProgress');
    if (dp) {
      var cid = dp.dataset.case;
      var csc = caseScore(cid);
      var cardsKnown = (store.cards[cid] || []).length;
      var cardTotal = ((EX[cid] && EX[cid].cards) || []).length;
      var plan = store.plan[cid] || {};
      var planDone = Object.keys(plan).filter(function (k) { return plan[k]; }).length;
      var planTotal = 0;
      ((EX[cid] && EX[cid].plan) || []).forEach(function (d) { planTotal += d.items.length; });
      var bits = [
        'Known: <b>' + csc.known + ' / ' + csc.total + '</b>',
        'Due now: <b>' + dueFor(cid) + '</b>'
      ];
      if (cardTotal) bits.push('Cards: <b>' + cardsKnown + ' / ' + cardTotal + '</b>');
      if (planTotal) bits.push('Plan: <b>' + planDone + ' / ' + planTotal + '</b>');
      dp.innerHTML = bits.map(function (b) { return '<span class="chip">' + b + '</span>'; }).join('');
    }
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    initTheme();
    initScroll();
    initNav();
    initCaseSwitch();
    initCaseDrills();
    initReference();
    initCards();
    initPlan();
    initVerbs();
    initToday();
    initMixed();
    initProgress();
    initSync();
    updateMeters();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
