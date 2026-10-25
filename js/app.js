/* Veritas Chambers — single classic script (works from file:// and http://).
   Phones / portrait screens: canvas image-sequence scrub (smooth, no video seeking).
   Desktop landscape: scroll-scrubbed video + pointer drift + grain. */
(function () {
  'use strict';
  var COMPACT_AT = .04, DRIFT_TAU = .32, DRIFT = [8, 5], GRAIN_FPS = 6, PHONE = 700;
  var MIN_SEEK = 1 / 40, WATCHDOG = 4000, FRAMES = 72, SEQ_DPR = 1.5, SEQ_TAU = .07, CONCURRENCY = 4;
  var clamp = function (n, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a === undefined ? 0 : a, n)); };
  var smooth = function (t) { t = clamp(t); return t * t * (3 - 2 * t); };
  var force = /[?&]motion/.test(location.search);
  var mq = matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = function () { return mq.matches && !force; };
  var seqMode = function () { return innerWidth <= 900 || innerHeight > innerWidth; };
  if (force) document.documentElement.classList.add('force-motion');

  function seeker(video, onFail) {   // video mode: one seek in flight, one pending
    var inflight = false, pending = null, shown = 0, timer = 0, dead = false;
    var usable = function () { return Math.max(0, (video.duration || 0) - 1 / 24); };
    function go(t) { inflight = true; clearTimeout(timer); timer = setTimeout(function () { dead = true; onFail(); }, WATCHDOG); video.currentTime = t; }
    video.addEventListener('seeked', function () {
      clearTimeout(timer); shown = video.currentTime; inflight = false;
      if (pending !== null && Math.abs(pending - shown) >= MIN_SEEK) { var t = pending; pending = null; go(t); } else pending = null;
    });
    return { request: function (f) {
      if (dead || !video.duration) return;
      var t = clamp(f) * usable();
      if (Math.abs(t - shown) < MIN_SEEK && !inflight) return;
      if (inflight) pending = t; else go(t);
    } };
  }

  /* image-sequence player: draws one frame cover-fit into a canvas */
  function sequence(scene, name, dirty) {
    var cv = document.createElement('canvas'); cv.className = 'seq-canvas'; cv.setAttribute('aria-hidden', 'true');
    scene.appendChild(cv);
    var ctx = cv.getContext('2d', { alpha: false }), frames = new Array(FRAMES), cur = -1, cw = 0, ch = 0;
    function size() {
      var r = scene.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, SEQ_DPR);
      cw = cv.width = Math.max(1, Math.round(r.width * d)); ch = cv.height = Math.max(1, Math.round(r.height * d)); cur = -1;
    }
    function draw(i) {
      var k = i; while (k >= 0 && !frames[k]) k--;
      if (k < 0) { k = i; while (k < FRAMES && !frames[k]) k++; }
      if (k < 0 || k >= FRAMES || k === cur) return;
      var im = frames[k], s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
      ctx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h); cur = k;
      if (!scene.classList.contains('live')) scene.classList.add('live');
    }
    // coarse-to-fine order so scrubbing works before everything has arrived
    var order = [], i, seen = {};
    [8, 4, 2, 1].forEach(function (st) { for (i = 0; i < FRAMES; i += st) if (!seen[i]) { seen[i] = 1; order.push(i); } });
    var qi = 0, active = 0, started = false, want = 0;
    function pump() {
      while (active < CONCURRENCY && qi < order.length) {
        (function (idx) {
          active++; var im = new Image(); im.decoding = 'async';
          im.onload = im.onerror = function () { if (im.naturalWidth) frames[idx] = im; active--; dirty(); pump(); };
          im.src = 'assets/seq/' + name + '/' + ('00' + (idx + 1)).slice(-3) + '.webp';
        })(order[qi++]);
      }
    }
    return {
      size: size, load: function () { if (!started) { started = true; pump(); } },
      show: function (p) { want = clamp(Math.round(p * (FRAMES - 1)), 0, FRAMES - 1); draw(want); },
      invalidate: function () { cur = -1; }, remove: function () { cv.remove(); }
    };
  }

  var ctrl = null;
  function start() {
    if (ctrl || reduced()) return;
    var root = document.documentElement; root.classList.add('js');
    var seq = seqMode(); root.classList.toggle('seq', seq);
    var stageEl = document.querySelector('.stage'), grain = stageEl.querySelector('.grain');
    var scenes = [].slice.call(stageEl.querySelectorAll('.scene'));
    var panels = [].slice.call(document.querySelectorAll('.panel'));
    var bar = document.getElementById('bar');
    var N = scenes.length, vh = innerHeight, geo = [], dirtyFlag = true, lastY = -1;
    var dirty = function () { dirtyFlag = true; };
    var fine = !seq && matchMedia('(pointer:fine) and (hover:hover)').matches;
    var names = ['chambers', 'court', 'brief'];
    var sp = scenes.map(function () { return 0; });   // damped progress (sequence mode)
    var players = [], seekers = [];

    if (seq) {
      players = scenes.map(function (s, i) { return sequence(s, names[i], dirty); });
      players.forEach(function (p) { p.size(); });
      players[0].load();
      var chain = function (i) {   // preload scene i+1 once the scrolled scene is near
        if (players[i]) players[i].load();
      };
      setTimeout(function () { chain(1); }, 600); setTimeout(function () { chain(2); }, 1800);
    } else {
      seekers = scenes.map(function (s) {
        var v = s.querySelector('video'); v.muted = true; v.src = v.dataset.src; v.load();
        v.addEventListener('loadeddata', function () { s.classList.add('live'); }, { once: true });
        v.addEventListener('error', function () { s.classList.remove('live'); });
        return seeker(v, function () { s.classList.remove('live'); });
      });
    }

    function measure() { vh = innerHeight; geo = panels.map(function (p) { return { top: p.offsetTop, h: Math.max(1, p.offsetHeight - vh) }; }); dirty(); }
    var fadeIn = function (i, y) { return i === 0 ? 1 : smooth((y - (geo[i].top - vh)) / vh); };
    var kids = panels.map(function (p) { return [].slice.call(p.querySelector('.sticky').children); });
    var animating = false;

    function updateStage(y, dt) {
      animating = false;
      panels.forEach(function (p, i) {
        var g = geo[i]; if (!g) return;
        var local = clamp((y - g.top) / g.h), target = smooth(local);
        if (seq) {
          sp[i] += (target - sp[i]) * (1 - Math.exp(-dt / SEQ_TAU));
          if (Math.abs(sp[i] - target) < .0008) sp[i] = target; else animating = true;
          players[i].show(sp[i]);
        } else seekers[i].request(target);
        scenes[i].style.opacity = (i < N - 1 && fadeIn(i + 1, y) >= 1) ? 0 : fadeIn(i, y);
        var enter = clamp((y - (g.top - vh * .6)) / (vh * .6));
        var exit = i < N - 1 ? smooth((local - .8) / .2) : 0;
        kids[i].forEach(function (el, j) {
          var e = smooth(enter * 1.7 - j * .3), v = e * (1 - exit);
          el.style.opacity = v.toFixed(3);
          el.style.transform = 'translate3d(0,' + (((1 - e) * 36) - exit * 28).toFixed(1) + 'px,0)';
          if (fine) el.style.filter = v < .99 ? 'blur(' + ((1 - v) * 8).toFixed(1) + 'px)' : 'none';
        });
      });
    }

    var compact = null, firstHdr = true;
    function measureBar() {
      var was = bar.classList.contains('compact');
      bar.classList.add('measuring', 'compact'); bar.style.width = 'max-content';
      var w = bar.getBoundingClientRect().width;
      bar.classList.toggle('compact', was); bar.style.width = ''; void bar.offsetWidth; bar.classList.remove('measuring');
      return w;
    }
    function setBar(c, instant) {
      if (c === compact) return; compact = c;
      if (instant) bar.classList.add('measuring');
      var w = c ? measureBar() : null;
      bar.classList.toggle('compact', c); bar.style.width = c ? w + 'px' : '';
      if (instant) { void bar.offsetWidth; bar.classList.remove('measuring'); }
    }
    var wantCompact = function (y) { return innerWidth <= PHONE || y > innerHeight * COMPACT_AT; };

    var tg = { x: 0, y: 0 }, cu = { x: 0, y: 0 }, gacc = 0;
    var onMove = function (e) { if (e.pointerType === 'touch') return; tg.x = e.clientX / innerWidth * 2 - 1; tg.y = e.clientY / innerHeight * 2 - 1; };
    var onLeave = function () { tg.x = 0; tg.y = 0; };
    if (fine) { addEventListener('pointermove', onMove, { passive: true }); root.addEventListener('pointerleave', onLeave); }

    var last = performance.now(), raf = 0, resizeT = 0, lastW = innerWidth, lastH = innerHeight;
    function tick(now) {   // the one and only ticker
      var dt = Math.min(.25, (now - last) / 1000); last = now; var y = scrollY;
      if (!fine && y === lastY && !animating && !dirtyFlag) { raf = requestAnimationFrame(tick); return; }   // idle: do nothing
      lastY = y; dirtyFlag = false;
      updateStage(y, dt);
      setBar(wantCompact(y), firstHdr); firstHdr = false;
      if (fine) {
        var k = 1 - Math.exp(-dt / DRIFT_TAU); cu.x += (tg.x - cu.x) * k; cu.y += (tg.y - cu.y) * k;
        stageEl.style.setProperty('--dx', (cu.x * DRIFT[0]).toFixed(2) + 'px'); stageEl.style.setProperty('--dy', (cu.y * DRIFT[1]).toFixed(2) + 'px');
        gacc += dt;
        if (panels[1] && y < panels[1].offsetTop && gacc > 1 / GRAIN_FPS) { gacc = 0; grain.style.transform = 'translate(' + (-Math.floor(Math.random() * 180)) + 'px,' + (-Math.floor(Math.random() * 180)) + 'px)'; }
      }
      raf = requestAnimationFrame(tick);
    }
    function onResize() {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        // ignore phone address-bar height wobble; rebuild only on real width/orientation change
        var realW = Math.abs(innerWidth - lastW) > 1, realH = Math.abs(innerHeight - lastH) > 160;
        if (!realW && !realH) return;
        lastW = innerWidth; lastH = innerHeight;
        if (seqMode() !== seq) { stop(); start(); return; }
        measure(); if (seq) players.forEach(function (p) { p.size(); });
        compact = null; setBar(wantCompact(scrollY), true);
      }, 200);
    }
    measure(); addEventListener('resize', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    addEventListener('load', measure);
    raf = requestAnimationFrame(tick);

    ctrl = { stop: function () {
      cancelAnimationFrame(raf); removeEventListener('resize', onResize); removeEventListener('pointermove', onMove); root.removeEventListener('pointerleave', onLeave);
      players.forEach(function (p) { p.remove(); });
      scenes.forEach(function (s) { s.style.opacity = ''; });
      kids.forEach(function (a) { a.forEach(function (el) { el.style.cssText = ''; }); });
      stageEl.style.removeProperty('--dx'); stageEl.style.removeProperty('--dy'); grain.style.transform = '';
      bar.classList.remove('compact', 'measuring'); bar.style.width = ''; root.classList.remove('js', 'seq');
    } };
  }
  function stop() { if (ctrl) { ctrl.stop(); ctrl = null; } }
  mq.addEventListener('change', function () { reduced() ? stop() : start(); });
  start();
})();
