// ==UserScript==
// @name         Video Gestures
// @namespace    https://github.com/copreus/firefox-fork
// @version      0.3.0
// @description  Floating video toolbar plus a fullscreen gesture player the page can't pause: drag to seek, left side for brightness, right side for volume, double-tap to skip, hold for 2x.
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @sandbox      JavaScript
// @inject-into  page
// @updateURL    https://raw.githubusercontent.com/copreus/firefox-fork/ccr-01175c86-4gdter/video-gestures.user.js
// @downloadURL  https://raw.githubusercontent.com/copreus/firefox-fork/ccr-01175c86-4gdter/video-gestures.user.js
// ==/UserScript==

(function () {
  'use strict';

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (W.__videoGesturesLoaded) return;
  W.__videoGesturesLoaded = true;

  // ------------------------------------------------------------------ config
  const MIN_W = 160;            // smallest video that gets the floating bar
  const MIN_H = 90;
  const SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75];
  const SKIP = 10;              // seconds for double-tap skip
  const MAX_SWIPE_RANGE = 120;  // a full-width swipe seeks at most this many seconds
  const HUD_HIDE_MS = 3000;

  // ------------------------------------------------------------------ helpers
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fsEl = () => document.fullscreenElement || document.mozFullScreenElement || null;

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  // Builds DOM without innerHTML (sites like YouTube enforce Trusted Types).
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) el.append(c);
    return el;
  }

  function icon(d, size = 24) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'currentColor');
    s.append(p);
    return s;
  }

  const ICON = {
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
    fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    exitFs: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
    mute: 'M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2v-2H2v2zm18 0h2v-2h-2v2zM11 2v2h2V2h-2zm0 18v2h2v-2h-2zM5.99 4.58 4.58 5.99l1.42 1.41 1.41-1.41zM18 16.6l-1.41 1.41L18 19.42 19.42 18zM19.42 6 18 4.58 16.59 6 18 7.41zM7.41 18 6 16.59 4.58 18 6 19.42z',
    fast: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
  };

  // ------------------------------------------------------------------ fullscreen plumbing
  // When a site (or our button) fullscreens a bare <video>, there is nowhere to draw an
  // overlay. We redirect video fullscreen requests to the video's parent instead and
  // stretch the video to fill it.
  const ACTIVE_ATTR = 'data-vg-active'; // the video we are controlling
  const FS_ATTR = 'data-vg-fs';         // the fullscreen element, while our player is mounted
  const PATH_ATTR = 'data-vg-path';     // elements between the fullscreen element and the video
  const ElementProto = W.Element.prototype;
  const origRequestFs = ElementProto.requestFullscreen || ElementProto.mozRequestFullScreen;

  function markActive(video) {
    for (const v of document.querySelectorAll(`video[${ACTIVE_ATTR}]`)) v.removeAttribute(ACTIVE_ATTR);
    video.setAttribute(ACTIVE_ATTR, '');
  }

  function enterFullscreen(video) {
    const host = video.parentElement;
    markActive(video);
    if (!host || !origRequestFs) return Promise.reject(new Error('fullscreen unavailable'));
    const r = origRequestFs.call(host, { navigationUI: 'hide' });
    return r && typeof r.then === 'function' ? r : Promise.resolve();
  }

  function exitFullscreen() {
    const f = origExitFs.exitFullscreen || origExitFs.mozCancelFullScreen;
    if (f && fsEl()) f.call(document);
  }

  try {
    const vp = W.HTMLVideoElement.prototype;
    for (const name of ['requestFullscreen', 'mozRequestFullScreen']) {
      if (!(name in ElementProto)) continue;
      Object.defineProperty(vp, name, {
        configurable: true,
        writable: true,
        value: function () {
          if (this.parentElement) return enterFullscreen(this);
          return origRequestFs.apply(this, arguments);
        },
      });
    }
  } catch (_) { /* page refused the patch; site-fullscreened containers still work */ }

  // ------------------------------------------------------------------ play guard
  // We run before the page's scripts, so we keep the real play/pause/exitFullscreen for
  // ourselves and hand the page versions that do nothing while our player is mounted.
  // Videos in `guarded` ignore pause() from page code; only our own calls get through.
  const MediaProto = W.HTMLMediaElement.prototype;
  const origPlay = MediaProto.play;
  const origPause = MediaProto.pause;
  const guarded = new WeakSet();
  const realPlay = (v) => { try { return Promise.resolve(origPlay.call(v)); } catch (e) { return Promise.reject(e); } };
  const realPause = (v) => origPause.call(v);
  try {
    Object.defineProperty(MediaProto, 'pause', {
      configurable: true, writable: true,
      value: function pause() { if (guarded.has(this)) return; return origPause.apply(this, arguments); },
    });
  } catch (_) {}

  const DocProto = W.Document.prototype;
  const origExitFs = {};
  for (const name of ['exitFullscreen', 'mozCancelFullScreen']) {
    const f = DocProto[name];
    if (typeof f !== 'function') continue;
    origExitFs[name] = f;
    try {
      Object.defineProperty(DocProto, name, {
        configurable: true, writable: true,
        value: function () {
          if (overlay) return name === 'exitFullscreen' ? Promise.resolve() : undefined; // page can't kick us out
          return f.apply(this, arguments);
        },
      });
    } catch (_) {}
  }

  // While our player is mounted, everything inside the fullscreen element except the
  // video (and the elements that contain it) is hidden: the site's controls, title bars,
  // gradients, spinners, captions and ads all disappear. The video is pinned full screen.
  const PAGE_CSS = `
    [${FS_ATTR}] { background: #000 !important; }
    [${FS_ATTR}] *:not([${PATH_ATTR}]):not(video[${ACTIVE_ATTR}]):not([data-video-gestures]) {
      visibility: hidden !important;
    }
    [${FS_ATTR}]::before, [${FS_ATTR}]::after,
    [${PATH_ATTR}]::before, [${PATH_ATTR}]::after { visibility: hidden !important; }
    [${PATH_ATTR}] {
      visibility: visible !important; opacity: 1 !important;
      background: transparent !important; box-shadow: none !important; border-color: transparent !important;
      transform: none !important; filter: none !important; backdrop-filter: none !important;
      clip-path: none !important; mask: none !important; contain: none !important;
      perspective: none !important; will-change: auto !important;
    }
    [${FS_ATTR}] video[${ACTIVE_ATTR}] {
      position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 0 !important;
      width: 100vw !important; height: 100vh !important;
      max-width: none !important; max-height: none !important; min-width: 0 !important; min-height: 0 !important;
      object-fit: contain !important; object-position: center !important;
      transform: none !important; filter: none !important; clip-path: none !important;
      visibility: visible !important; opacity: 1 !important; background: #000 !important;
      z-index: 2147483646 !important;
    }
    [${FS_ATTR}] > [data-video-gestures] { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; }`;

  function injectPageCss() {
    const s = document.createElement('style');
    s.textContent = PAGE_CSS;
    (document.head || document.documentElement).append(s);
  }

  // ------------------------------------------------------------------ video picking
  function visibleArea(r) {
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const hgt = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return Math.max(0, w) * Math.max(0, hgt);
  }

  function pickVideo(videos, opts = {}) {
    let best = null, bestScore = 0;
    for (const v of videos) {
      if (opts.skip && opts.skip.has(v)) continue;
      const r = v.getBoundingClientRect();
      if (opts.minSize && (r.width < MIN_W || r.height < MIN_H)) continue;
      const vis = visibleArea(r);
      if (opts.minSize && vis < r.width * r.height * 0.3) continue;
      const score = vis * (v.paused ? 1 : 2);
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return best;
  }

  // ------------------------------------------------------------------ download
  function findMediaUrl(video) {
    const ok = (u) => u && !/^(blob|mediasource|data):/i.test(u);
    if (ok(video.currentSrc)) return { url: video.currentSrc, kind: 'direct' };
    if (ok(video.src)) return { url: video.src, kind: 'direct' };
    for (const s of video.querySelectorAll('source')) if (ok(s.src)) return { url: s.src, kind: 'direct' };
    const urls = performance.getEntriesByType('resource').map((e) => e.name).reverse();
    const hls = urls.find((u) => /\.m3u8(\?|#|$)/i.test(u));
    if (hls) return { url: hls, kind: 'HLS playlist' };
    const dash = urls.find((u) => /\.mpd(\?|#|$)/i.test(u));
    if (dash) return { url: dash, kind: 'DASH manifest' };
    return null;
  }

  async function download(video, toast) {
    const found = findMediaUrl(video);
    if (!found) return toast("Can't find a downloadable file — this video is streamed in pieces.");
    if (found.kind === 'direct') {
      W.open(found.url, '_blank');
      return toast('Opened video file — long-press it to save.');
    }
    try {
      await navigator.clipboard.writeText(found.url);
      toast(`Streamed video: ${found.kind} URL copied.`);
    } catch (_) {
      toast(`Streamed video (${found.kind}) — can't download directly.`);
    }
  }

  // ------------------------------------------------------------------ floating bar
  const BAR_CSS = `
    :host { all: initial; }
    .bar {
      display: flex; align-items: center; gap: 2px; padding: 4px 6px;
      background: rgba(72, 72, 80, 0.88); color: #fff; border-radius: 999px;
      box-shadow: 0 2px 10px rgba(0,0,0,.35);
      font: 600 14px/1 system-ui, -apple-system, Roboto, sans-serif;
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      touch-action: manipulation; user-select: none;
    }
    button {
      all: unset; box-sizing: border-box; min-width: 40px; height: 40px; padding: 0 8px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px; color: inherit; font: inherit; cursor: pointer;
    }
    button:active { background: rgba(255,255,255,.18); }
    .close { opacity: .7; min-width: 32px; }
    .toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      max-width: calc(100vw - 32px); padding: 10px 14px; border-radius: 10px;
      background: rgba(20,20,24,.92); color: #fff; font: 14px/1.35 system-ui, Roboto, sans-serif;
      opacity: 0; transition: opacity .2s; pointer-events: none; text-align: center;
    }
    .toast.show { opacity: 1; }`;

  function createBar() {
    const hostEl = h('div', { 'data-video-gestures': 'bar' });
    hostEl.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;display:none;';
    const root = hostEl.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BAR_CSS;

    let video = null;
    const dismissed = new WeakSet();
    const toastEl = h('div', { class: 'toast' });
    let toastTimer = 0;
    const toast = (msg) => {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
    };

    const speedBtn = h('button', { title: 'Playback speed', onclick: () => {
      if (!video) return;
      const i = SPEEDS.indexOf(video.playbackRate);
      video.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
      speedBtn.textContent = `${video.playbackRate}×`;
    } }, '1×');
    const dlBtn = h('button', { title: 'Download', onclick: () => video && download(video, toast) }, icon(ICON.download));
    const fsBtn = h('button', { title: 'Fullscreen', onclick: () => {
      if (video) enterFullscreen(video).catch(() => toast('Fullscreen was blocked by the page.'));
    } }, icon(ICON.fullscreen));
    const closeBtn = h('button', { class: 'close', title: 'Hide for this video', onclick: () => {
      if (video) dismissed.add(video);
      place();
    } }, icon(ICON.close, 18));

    const bar = h('div', { class: 'bar' }, speedBtn, dlBtn, fsBtn, closeBtn);
    root.append(style, bar, toastEl);
    for (const t of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
      hostEl.addEventListener(t, (e) => e.stopPropagation());
    }

    function place() {
      if (!hostEl.isConnected) document.documentElement.append(hostEl);
      video = fsEl() ? null : pickVideo(document.getElementsByTagName('video'), { minSize: true, skip: dismissed });
      if (!video) { hostEl.style.display = 'none'; return; }
      hostEl.style.display = 'block';
      speedBtn.textContent = `${video.playbackRate}×`;
      const r = video.getBoundingClientRect();
      const bw = bar.offsetWidth, bh = bar.offsetHeight;
      let top = r.bottom + 8;
      if (top + bh > innerHeight - 8) top = r.bottom - bh - 8; // no room below: sit inside the video
      top = clamp(top, 8, Math.max(8, innerHeight - bh - 8));
      const left = clamp(r.right - bw - 8, 8, Math.max(8, innerWidth - bw - 8));
      hostEl.style.left = `${Math.round(left)}px`;
      hostEl.style.top = `${Math.round(top)}px`;
    }

    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };
    addEventListener('scroll', schedule, { passive: true, capture: true });
    addEventListener('resize', schedule, { passive: true });
    setInterval(place, 500);
    place();
    return { place: schedule };
  }

  // ------------------------------------------------------------------ fullscreen gesture overlay
  const OVERLAY_CSS = `
    :host { all: initial; }
    .wrap { position: absolute; inset: 0; font: 14px/1.2 system-ui, -apple-system, Roboto, sans-serif; color: #fff;
            user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
    .own { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
    .dim { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
    .layer { position: absolute; inset: 0; touch-action: none; }
    .bubble {
      position: absolute; left: 50%; top: 22%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 14px;
      background: rgba(0,0,0,.62); font-weight: 600; font-size: 16px; white-space: nowrap;
      opacity: 0; transition: opacity .15s; pointer-events: none;
    }
    .bubble.show { opacity: 1; }
    .bubble .sub { opacity: .75; font-weight: 500; font-size: 14px; }
    .meter { width: 120px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.3); overflow: hidden; }
    .meter > i { display: block; height: 100%; background: #fff; width: 0; }
    .ripple { position: absolute; top: 0; bottom: 0; width: 38%; display: flex; align-items: center; justify-content: center;
              font-weight: 700; font-size: 18px; opacity: 0; transition: opacity .25s; pointer-events: none;
              background: radial-gradient(closest-side, rgba(255,255,255,.18), transparent); }
    .ripple.left { left: 0; } .ripple.right { right: 0; }
    .ripple.show { opacity: 1; transition: none; }
    .hud { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .2s; }
    .hud.show { opacity: 1; }
    .hud.show button, .hud.show .track { pointer-events: auto; }
    .shade { position: absolute; inset: 0; background: linear-gradient(rgba(0,0,0,.55), transparent 22%, transparent 70%, rgba(0,0,0,.65)); }
    .top { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px;
           padding: max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left)); }
    .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 15px; }
    .mid { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 36px; }
    .bottom { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 12px;
              padding: 10px max(16px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
              font-variant-numeric: tabular-nums; font-size: 13px; }
    button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
             min-width: 44px; height: 44px; padding: 0 10px; border-radius: 999px; cursor: pointer; color: #fff; font: 600 15px system-ui, Roboto, sans-serif; }
    button:active { background: rgba(255,255,255,.2); }
    .big { width: 68px; height: 68px; background: rgba(0,0,0,.4); }
    .skip { background: rgba(0,0,0,.3); }
    .track { position: relative; flex: 1; height: 28px; display: flex; align-items: center; touch-action: none; }
    .rail { position: relative; width: 100%; height: 4px; border-radius: 2px; background: rgba(255,255,255,.3); }
    .buf, .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; }
    .buf { background: rgba(255,255,255,.45); }
    .fill { background: #fff; }
    .knob { position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #fff; }`;

  let overlay = null;
  let floatingBar = null;
  let brightness = 1; // remembered between fullscreen sessions on this page

  function mountOverlay(container, source, opts = {}) {
    if (overlay && overlay.container === container && overlay.source === source) return;
    teardownOverlay();

    // Direct mode: if the site's video is a plain file, play that file in our own <video>
    // inside a closed shadow root. Page scripts have no way to reach it, so they can't
    // pause it, seek it or swap its source. The site's video is paused and muted underneath.
    const found = opts.noDirect ? null : findMediaUrl(source);
    const direct = !!(found && found.kind === 'direct');
    const video = direct
      ? h('video', { class: 'own', src: found.url, playsinline: '', preload: 'auto' })
      : source;

    container.setAttribute(FS_ATTR, '');
    if (!direct) {
      // Mark the chain of elements leading to the site's video so PAGE_CSS hides everything else.
      markActive(source);
      for (let el = source.parentElement; el && el !== container; el = el.parentElement) el.setAttribute(PATH_ATTR, '');
    }
    guarded.add(video);

    const ac = new AbortController();
    const sig = { signal: ac.signal };
    const hostEl = h('div', { 'data-video-gestures': 'overlay' });
    hostEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:2147483647;';
    const root = hostEl.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;

    // --- elements
    const dim = h('div', { class: 'dim' });
    const layer = h('div', { class: 'layer' });
    const bubbleIcon = h('span');
    const bubbleText = h('span');
    const bubbleSub = h('span', { class: 'sub' });
    const meterFill = h('i');
    const meter = h('div', { class: 'meter' }, meterFill);
    const bubble = h('div', { class: 'bubble' }, bubbleIcon, bubbleText, meter, bubbleSub);
    const ripL = h('div', { class: 'ripple left' });
    const ripR = h('div', { class: 'ripple right' });

    const title = h('div', { class: 'title' }, document.title || '');
    const speedBtn = h('button', { title: 'Speed' }, '1×');
    const exitBtn = h('button', { title: 'Exit fullscreen' }, icon(ICON.exitFs));
    const playBtn = h('button', { class: 'big', title: 'Play/pause' }, icon(ICON.play, 36));
    const backBtn = h('button', { class: 'skip' }, `−${SKIP}`);
    const fwdBtn = h('button', { class: 'skip' }, `+${SKIP}`);
    const cur = h('span', {}, '0:00');
    const dur = h('span', {}, '0:00');
    const buf = h('div', { class: 'buf' });
    const fill = h('div', { class: 'fill' });
    const knob = h('div', { class: 'knob' });
    const track = h('div', { class: 'track' }, h('div', { class: 'rail' }, buf, fill, knob));
    const hud = h('div', { class: 'hud' },
      h('div', { class: 'shade' }),
      h('div', { class: 'top' }, title, speedBtn, exitBtn),
      h('div', { class: 'mid' }, backBtn, playBtn, fwdBtn),
      h('div', { class: 'bottom' }, cur, track, dur));

    root.append(style, h('div', { class: 'wrap' }, direct ? video : null, dim, layer, ripL, ripR, hud, bubble));
    container.append(hostEl);

    // If page code yanks our overlay out while still fullscreen, put it back.
    const reattach = new MutationObserver(() => {
      if (!hostEl.isConnected && fsEl() === container) container.append(hostEl);
    });
    reattach.observe(container, { childList: true });

    let userPaused = false;
    const play = () => { userPaused = false; return realPlay(video).catch(() => { userPaused = true; }); };
    const pause = () => { userPaused = true; realPause(video); };

    // Whatever pauses the video (page code, a site player holding the real pause(), a
    // focus/visibility handler), resume it unless it was the user.
    video.addEventListener('pause', () => {
      setTimeout(() => {
        if (overlay && overlay.video === video && !userPaused && video.paused && !video.ended) realPlay(video).catch(() => {});
      }, 0);
    }, sig);

    let sourceMuted = source.muted;
    if (direct) {
      const startAt = source.currentTime;
      video.playbackRate = source.playbackRate || 1;
      video.volume = source.volume;
      video.muted = source.muted;
      video.addEventListener('loadedmetadata', () => {
        if (startAt > 0 && (!isFinite(video.duration) || startAt < video.duration)) video.currentTime = startAt;
      }, { once: true, signal: ac.signal });
      // Silence the site's copy and keep it stopped, however hard the page tries.
      source.muted = true;
      realPause(source);
      source.addEventListener('play', () => { source.muted = true; realPause(source); }, sig);
      // If the file won't load in our player (e.g. a link that only works inside the site's
      // player), fall back to guarding the site's own video.
      video.addEventListener('error', () => {
        if (!overlay || overlay.video !== video) return;
        teardownOverlay();
        source.muted = sourceMuted;
        mountOverlay(container, source, { noDirect: true });
      }, sig);
      play();
    } else {
      userPaused = video.paused;
    }

    // Keep the site's own player from reacting to our touches.
    for (const t of ['click', 'dblclick', 'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchend', 'touchmove', 'contextmenu']) {
      hostEl.addEventListener(t, (e) => {
        e.stopPropagation();
        if (t === 'contextmenu') e.preventDefault();
      }, sig);
    }

    // --- state helpers
    const duration = () => (isFinite(video.duration) ? video.duration : NaN);
    const setDim = (b) => { brightness = b; dim.style.opacity = String(1 - b); };
    setDim(brightness);

    let bubbleTimer = 0;
    function showBubble(iconPath, text, opts = {}) {
      bubbleIcon.replaceChildren(iconPath ? icon(iconPath, 22) : '');
      bubbleText.textContent = text || '';
      bubbleSub.textContent = opts.sub || '';
      meter.style.display = opts.level == null ? 'none' : '';
      if (opts.level != null) meterFill.style.width = `${Math.round(opts.level * 100)}%`;
      bubble.classList.add('show');
      clearTimeout(bubbleTimer);
      if (!opts.sticky) bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 700);
    }
    const hideBubbleSoon = () => { clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 500); };

    let hudTimer = 0;
    function showHud() {
      hud.classList.add('show');
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => { if (!video.paused) hud.classList.remove('show'); }, HUD_HIDE_MS);
    }
    const hideHud = () => { clearTimeout(hudTimer); hud.classList.remove('show'); };
    const toggleHud = () => (hud.classList.contains('show') ? hideHud() : showHud());

    function render() {
      const d = duration();
      const t = video.currentTime;
      cur.textContent = fmt(t);
      dur.textContent = isFinite(d) ? fmt(d) : 'LIVE';
      const p = isFinite(d) && d > 0 ? clamp(t / d, 0, 1) : 0;
      fill.style.width = `${p * 100}%`;
      knob.style.left = `${p * 100}%`;
      let b = 0;
      try { if (video.buffered.length && d > 0) b = video.buffered.end(video.buffered.length - 1) / d; } catch (_) {}
      buf.style.width = `${clamp(b, 0, 1) * 100}%`;
      playBtn.replaceChildren(icon(video.paused ? ICON.play : ICON.pause, 36));
      speedBtn.textContent = `${video.playbackRate}×`;
    }
    for (const ev of ['timeupdate', 'play', 'pause', 'durationchange', 'progress', 'ratechange', 'seeked', 'loadedmetadata']) {
      video.addEventListener(ev, render, sig);
    }
    video.addEventListener('pause', showHud, sig);
    render();
    showHud();
    if (direct) showBubble(null, 'Playing the video file directly');

    const togglePlay = () => { if (video.paused) play(); else pause(); };
    function skip(sec) {
      const d = duration();
      video.currentTime = clamp(video.currentTime + sec, 0, isFinite(d) ? d : video.currentTime + Math.abs(sec));
      const rip = sec < 0 ? ripL : ripR;
      rip.textContent = `${sec < 0 ? '−' : '+'}${Math.abs(sec)}s`;
      rip.classList.add('show');
      requestAnimationFrame(() => requestAnimationFrame(() => rip.classList.remove('show')));
    }

    // --- HUD buttons
    playBtn.addEventListener('click', () => { togglePlay(); showHud(); }, sig);
    backBtn.addEventListener('click', () => { skip(-SKIP); showHud(); }, sig);
    fwdBtn.addEventListener('click', () => { skip(SKIP); showHud(); }, sig);
    exitBtn.addEventListener('click', exitFullscreen, sig);
    speedBtn.addEventListener('click', () => {
      const i = SPEEDS.indexOf(video.playbackRate);
      video.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
      showHud();
    }, sig);

    // --- progress bar scrubbing
    function scrubTo(e) {
      const r = track.getBoundingClientRect();
      const d = duration();
      if (!isFinite(d)) return;
      video.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * d;
      render();
    }
    track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); scrubTo(e); showHud(); }, sig);
    track.addEventListener('pointermove', (e) => { if (track.hasPointerCapture(e.pointerId)) { scrubTo(e); showHud(); } }, sig);

    // --- gestures
    let g = null;
    let lastTap = { t: 0, x: 0 };
    let tapTimer = 0;

    layer.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      layer.setPointerCapture(e.pointerId);
      const r = layer.getBoundingClientRect();
      g = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, r, mode: null,
        t0: video.currentTime, vol0: video.muted ? 0 : video.volume, br0: brightness,
      };
      g.hold = setTimeout(() => {
        if (g && !g.mode && !video.paused) {
          g.mode = 'speed';
          g.rate0 = video.playbackRate;
          video.playbackRate = 2;
          showBubble(ICON.fast, '2× speed', { sticky: true });
        }
      }, 450);
    }, sig);

    layer.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.mode) {
        if (Math.hypot(dx, dy) < 14) return;
        clearTimeout(g.hold);
        if (Math.abs(dx) > Math.abs(dy)) g.mode = 'seek';
        else g.mode = (g.x0 - g.r.left) < g.r.width / 2 ? 'bright' : 'vol';
      }
      const span = g.r.height * 0.75;
      if (g.mode === 'seek') {
        const d = duration();
        const range = isFinite(d) ? Math.min(d, MAX_SWIPE_RANGE) : 60;
        g.target = clamp(g.t0 + (dx / g.r.width) * range, 0, isFinite(d) ? d : Infinity);
        const delta = g.target - g.t0;
        showBubble(null, `${fmt(g.target)} / ${isFinite(d) ? fmt(d) : 'LIVE'}`,
          { sub: `${delta < 0 ? '−' : '+'}${fmt(Math.abs(delta))}`, sticky: true });
      } else if (g.mode === 'vol') {
        const v = clamp(g.vol0 - dy / span, 0, 1);
        video.volume = v;
        video.muted = v === 0;
        showBubble(v === 0 ? ICON.mute : ICON.volume, `${Math.round(v * 100)}%`, { level: v, sticky: true });
      } else if (g.mode === 'bright') {
        const b = clamp(g.br0 - dy / span, 0.15, 1);
        setDim(b);
        showBubble(ICON.sun, `${Math.round(b * 100)}%`, { level: b, sticky: true });
      }
    }, sig);

    function endGesture(e) {
      if (!g || e.pointerId !== g.id) return;
      clearTimeout(g.hold);
      const mode = g.mode;
      if (mode === 'seek' && g.target != null) video.currentTime = g.target;
      if (mode === 'speed') video.playbackRate = g.rate0;
      if (mode) hideBubbleSoon();
      if (!mode && e.type === 'pointerup') {
        const now = performance.now();
        const xr = (e.clientX - g.r.left) / g.r.width;
        if (now - lastTap.t < 300 && Math.abs(e.clientX - lastTap.x) < 90) {
          clearTimeout(tapTimer);
          lastTap = { t: now, x: e.clientX }; // allow tap-tap-tap to keep skipping
          if (xr < 0.4) skip(-SKIP);
          else if (xr > 0.6) skip(SKIP);
          else togglePlay();
        } else {
          lastTap = { t: now, x: e.clientX };
          tapTimer = setTimeout(toggleHud, 280);
        }
      }
      g = null;
    }
    layer.addEventListener('pointerup', endGesture, sig);
    layer.addEventListener('pointercancel', endGesture, sig);

    // --- orientation: landscape for wide videos
    function lockOrientation() {
      try {
        if (!video.videoWidth) return;
        const want = video.videoWidth >= video.videoHeight ? 'landscape' : 'portrait';
        screen.orientation.lock(want).catch(() => {});
      } catch (_) {}
    }
    lockOrientation();
    video.addEventListener('loadedmetadata', lockOrientation, sig);

    // Some sites swap the <video> element (ad -> show, quality change). Follow the playing one.
    // (Not needed in direct mode: our own video never gets swapped.)
    const swapCheck = direct ? 0 : setInterval(() => {
      if (!video.isConnected || (video.paused && userPaused)) {
        const next = pickVideo([...container.querySelectorAll('video')].filter((v) => !v.paused));
        if (next && next !== video) mountOverlay(container, next);
      }
    }, 1000);

    overlay = {
      container, video, source,
      destroy() {
        ac.abort();
        reattach.disconnect();
        guarded.delete(video);
        if (direct) {
          // Hand the position back to the site's player and stop our copy.
          try { if (video.currentTime > 0) source.currentTime = video.currentTime; } catch (_) {}
          source.muted = sourceMuted;
          realPause(video);
          video.removeAttribute('src');
          video.load();
        }
        clearInterval(swapCheck);
        clearTimeout(hudTimer); clearTimeout(bubbleTimer); clearTimeout(tapTimer);
        if (g) clearTimeout(g.hold);
        hostEl.remove();
        try { screen.orientation.unlock(); } catch (_) {}
      },
    };
  }

  function teardownOverlay() {
    if (!overlay) return;
    overlay.destroy();
    overlay = null;
    for (const el of document.querySelectorAll(`[${FS_ATTR}]`)) el.removeAttribute(FS_ATTR);
    for (const el of document.querySelectorAll(`[${PATH_ATTR}]`)) el.removeAttribute(PATH_ATTR);
    for (const v of document.querySelectorAll(`video[${ACTIVE_ATTR}]`)) v.removeAttribute(ACTIVE_ATTR);
  }

  function onFullscreenChange() {
    const el = fsEl();
    if (!el) { teardownOverlay(); if (floatingBar) floatingBar.place(); return; }
    if (el.tagName === 'VIDEO') return; // bare video fullscreen (e.g. browser's own controls): no room for an overlay
    const video = el.querySelector(`video[${ACTIVE_ATTR}]`) || pickVideo(el.querySelectorAll('video'));
    if (video) mountOverlay(el, video);
  }

  // ------------------------------------------------------------------ boot
  function init() {
    injectPageCss();
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('mozfullscreenchange', onFullscreenChange);
    floatingBar = createBar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
