/* ThunderStudy News front-end: theme, menu, header, progress bar, reveal, share, search. No dependencies. */
(function () {
  'use strict';
  var $ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var G = function (i) { return document.getElementById(i); };

  /* loader */
  function hideLoader() { var l = G('loader'); if (l) l.classList.add('hide'); }
  window.addEventListener('DOMContentLoaded', function () { setTimeout(hideLoader, 200); });
  setTimeout(hideLoader, 1500);

  /* theme toggle (same behaviour as the kit) */
  var themeBtn = G('themeBtn');
  if (themeBtn) {
    var sync = function () { themeBtn.setAttribute('aria-pressed', document.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false'); };
    sync();
    themeBtn.addEventListener('click', function () {
      var de = document.documentElement, next = de.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      function apply() {
        de.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (e) {}
        var mt = G('metaTheme'); if (mt) mt.setAttribute('content', next === 'dark' ? '#9A7AFB' : '#70A1FC');
        var ms = G('metaScheme'); if (ms) ms.setAttribute('content', next);
        sync();
      }
      var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!document.startViewTransition || reduce) { apply(); return; }
      var r = themeBtn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      var rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      de.classList.add('theme-swap');
      var t = document.startViewTransition(apply);
      t.ready.then(function () { de.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + rad + 'px at ' + x + 'px ' + y + 'px)'] }, { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' }); });
      t.finished.then(function () { de.classList.remove('theme-swap'); }, function () { de.classList.remove('theme-swap'); });
    });
  }

  /* mobile menu */
  var ham = G('hamBtn'), menu = G('mobileMenu');
  if (ham && menu) {
    ham.addEventListener('click', function () { var o = menu.classList.toggle('open'); ham.setAttribute('aria-expanded', o ? 'true' : 'false'); });
    $('a', menu).forEach(function (a) { a.addEventListener('click', function () { menu.classList.remove('open'); ham.setAttribute('aria-expanded', 'false'); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu.classList.contains('open')) { menu.classList.remove('open'); ham.setAttribute('aria-expanded', 'false'); ham.focus(); } });
  }

  /* header hides on scroll down, returns on scroll up */
  var nav = document.querySelector('.nav');
  if (nav) {
    var last = window.scrollY, tick = false;
    window.addEventListener('scroll', function () {
      if (tick) return; tick = true;
      requestAnimationFrame(function () {
        var y = window.scrollY, d = y - last;
        if (Math.abs(d) > 6) { nav.classList.toggle('up', d > 0 && y > 120); last = y; if (nav.classList.contains('up') && menu && menu.classList.contains('open') && ham) ham.click(); }
        if (y < 40) nav.classList.remove('up');
        tick = false;
      });
    }, { passive: true });
  }

  /* reading progress */
  var bar = G('progress'), art = document.querySelector('.article');
  if (bar && art) {
    var upd = function () {
      var r = art.getBoundingClientRect(), total = r.height - window.innerHeight * 0.6;
      var p = total > 0 ? Math.min(1, Math.max(0, (-r.top + 80) / total)) : 1;
      bar.style.transform = 'scaleX(' + p + ')';
    };
    window.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd); upd();
  }

  /* reveal on scroll */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    $('.reveal').forEach(function (el) { io.observe(el); });
  } else { $('.reveal').forEach(function (el) { el.classList.add('in'); }); }

  /* toast + copy link */
  var toast = G('toast'), tt;
  function say(m) { if (!toast) return; toast.textContent = m; toast.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { toast.classList.remove('show'); }, 1800); }
  $('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var url = b.getAttribute('data-copy');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { say('Link copied'); }, function () { say('Copy failed'); });
      else { var t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); say('Link copied'); } catch (e) { say('Copy failed'); } t.remove(); }
    });
  });

  /* native share, when the browser has it */
  $('[data-native-share]').forEach(function (b) {
    if (!navigator.share) { b.hidden = true; return; }
    b.addEventListener('click', function () { navigator.share({ title: document.title, url: location.href }).catch(function () {}); });
  });

  /* search page */
  var app = G('searchApp');
  if (app) {
    var input = G('q'), out = G('qResults'), status = G('qStatus'), data = null;
    var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var run = function () {
      if (!data) return;
      var q = input.value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
      if (!words.length) { out.innerHTML = ''; status.textContent = 'Type to search ' + data.length + ' stories.'; return; }
      var scored = [];
      data.forEach(function (p) {
        var hay = (p.t + ' ' + p.d + ' ' + p.c + ' ' + (p.k || '')).toLowerCase(), s = 0;
        for (var i = 0; i < words.length; i++) {
          if (hay.indexOf(words[i]) < 0) return;
          s += p.t.toLowerCase().indexOf(words[i]) >= 0 ? 3 : 1;
        }
        scored.push([s, p]);
      });
      scored.sort(function (a, b) { return b[0] - a[0] || (a[1].dt < b[1].dt ? 1 : -1); });
      var res = scored.slice(0, 30);
      status.textContent = res.length ? res.length + (scored.length > 30 ? '+' : '') + ' stories found for "' + input.value.trim() + '".' : 'No stories found for "' + input.value.trim() + '". Try a shorter keyword.';
      out.innerHTML = res.map(function (r) {
        var p = r[1];
        return '<a class="ncard" href="' + esc(p.u) + '"><div class="ncard-body"><span class="tag" style="--c:var(--' + esc(p.tn) + ');--k:var(--' + esc(p.tn) + '-ink)">' + esc(p.c) + '</span><h3>' + esc(p.t) + '</h3><p>' + esc(p.d) + '</p><div class="meta"><span>' + esc(p.ds) + '</span></div></div></a>';
      }).join('');
    };
    fetch('/search.json').then(function (r) { return r.json(); }).then(function (j) {
      data = j;
      var q = new URLSearchParams(location.search).get('q'); if (q) input.value = q;
      run();
    }).catch(function () { status.textContent = 'Search could not load. Please try again.'; });
    input.addEventListener('input', run);
    app.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); run(); });
  }
})();
