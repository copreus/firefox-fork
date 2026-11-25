// ==UserScript==
// @name         Video Gestures
// @namespace    https://github.com/copreus/firefox-fork
// @version      0.5.8
// @require      https://cdn.jsdelivr.net/npm/hls.js@1.7.4/dist/hls.min.js
// @description  Floating video toolbar plus a fullscreen gesture player the page can't pause: drag to seek, left side for brightness, right side for volume, double-tap to skip, hold for 2x.
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @sandbox      JavaScript
// @inject-into  page
// @updateURL    https://raw.githubusercontent.com/copreus/firefox-fork/ccr-4461f63e-19zvzq/video-gestures.user.js
// @downloadURL  https://raw.githubusercontent.com/copreus/firefox-fork/ccr-4461f63e-19zvzq/video-gestures.user.js
// ==/UserScript==

(function () {
  'use strict';

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (W.__videoGesturesLoaded) return;
  W.__videoGesturesLoaded = true;

  // hls.js comes in through @require. Keep our copy and take it back off the page's window
  // so the site never sees (or picks up) a second hls.js.
  const HlsLib = W.Hls || (typeof Hls !== 'undefined' ? Hls : null); // eslint-disable-line no-undef
  if (HlsLib && W.Hls === HlsLib) { try { delete W.Hls; } catch (_) {} }
  // Running in Firefox's content-script sandbox (the manager couldn't inject into the page)?
  // Then hls.js's worker messages arrive as page objects that hls.js can't write to, so it
  // fails with "Not allowed to define cross-origin object as property". Run it without the worker.
  // (Some managers set unsafeWindow === window even there, so ask Firefox directly: only a
  // sandboxed script sees wrappedJSObject / XPCNativeWrapper.)
  const sandboxed = (() => {
    try { return W !== window || typeof window.wrappedJSObject !== 'undefined' || typeof XPCNativeWrapper !== 'undefined'; } // eslint-disable-line no-undef
    catch (_) { return true; }
  })();
  const canNativeHls = () => !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');

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
    rotate: 'M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 18.29 0 12 0l-.66.03 3.81 3.81 1.33-1.32zm-6.25-.77c-.59-.59-1.54-.59-2.12 0L1.75 8.11c-.59.59-.59 1.54 0 2.12l12.02 12.02c.59.59 1.54.59 2.12 0l6.36-6.36c.59-.59.59-1.54 0-2.12L10.23 1.75zm4.6 19.44L2.81 9.17l6.36-6.36 12.02 12.02-6.36 6.36zm-7.31.29C4.25 19.94 1.91 16.76 1.55 13H.05C.56 19.16 5.71 24 12 24l.66-.03-3.81-3.81-1.33 1.32z',
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
    else if (W.parent !== W) W.parent.postMessage({ __videoGestures: 'exit' }, '*'); // fullscreen is our <iframe>
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
          if (overlay || fsFrame) return name === 'exitFullscreen' ? Promise.resolve() : undefined; // page can't kick us out
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
    [${FS_ATTR}] > [data-video-gestures="overlay"] { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; }`;

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

  // ------------------------------------------------------------------ finding the real source
  // Streamed videos play from a blob: URL, so the <video> doesn't say where the stream is.
  // Like a network sniffer, we watch every XHR/fetch the page makes and keep anything whose
  // *content* is an HLS playlist (#EXTM3U) or DASH manifest, whatever its URL looks like.
  const manifests = []; // { url, text, kind: 'hls-master' | 'hls-media' | 'dash', duration }
  const rangedFiles = []; // video files the page's player is pulling in byte ranges
  const MAX_MANIFEST = 5e6;
  const decoder = new TextDecoder();
  const absUrl = (u, base) => { try { return new URL(u, base || location.href).href; } catch (_) { return u; } };
  const looksManifest = (head) => /^﻿?\s*(#EXTM3U|<\?xml|<MPD[\s>])/i.test(head);

  function classifyManifest(text) {
    const t = text.replace(/^﻿/, '').trimStart();
    if (t.startsWith('#EXTM3U')) {
      if (/#EXT-X-STREAM-INF/i.test(t)) return 'hls-master';
      if (/#EXTINF/i.test(t)) return 'hls-media';
      return null;
    }
    if (/<MPD[\s>]/i.test(t.slice(0, 4096))) return 'dash';
    return null;
  }

  function recordManifest(url, text) {
    const kind = classifyManifest(text);
    if (!kind || !url) return;
    url = absUrl(url);
    let duration = NaN;
    if (kind === 'hls-media') {
      duration = 0;
      for (const m of text.matchAll(/#EXTINF:\s*([\d.]+)/gi)) duration += +m[1];
      if (!/#EXT-X-ENDLIST/i.test(text)) duration = Infinity;
    }
    const i = manifests.findIndex((m) => m.url === url);
    if (i >= 0) manifests.splice(i, 1);
    manifests.push({ url, text, kind, duration });
    if (manifests.length > 60) manifests.shift();
  }

  function recordRanged(url, type) {
    if (!/^(video|audio)\//i.test(type || '') || /mp2t|mpegurl/i.test(type)) return;
    url = absUrl(url);
    if (!/^https?:/i.test(url) || rangedFiles.includes(url)) return;
    rangedFiles.push(url);
    if (rangedFiles.length > 20) rangedFiles.shift();
  }

  try { performance.setResourceTimingBufferSize(5000); } catch (_) {}

  try {
    const XP = W.XMLHttpRequest.prototype;
    const origOpen = XP.open, origSend = XP.send;
    const xhrUrl = new WeakMap();
    function onXhrLoad() {
      try {
        const url = this.responseURL || xhrUrl.get(this);
        const type = this.getResponseHeader('content-type') || '';
        if (this.status === 206) return recordRanged(url, type);
        if (/^(video|audio|image)\//i.test(type)) return;
        const rt = this.responseType;
        if (rt === '' || rt === 'text') {
          const txt = this.responseText;
          if (txt && txt.length < MAX_MANIFEST && looksManifest(txt.slice(0, 64))) recordManifest(url, txt);
        } else if (rt === 'arraybuffer' && this.response && this.response.byteLength < MAX_MANIFEST) {
          const u8 = new Uint8Array(this.response);
          if (looksManifest(decoder.decode(u8.subarray(0, 64)))) recordManifest(url, decoder.decode(u8));
        }
      } catch (_) {}
    }
    XP.open = function open(method, url) {
      try { xhrUrl.set(this, String(url)); } catch (_) {}
      return origOpen.apply(this, arguments);
    };
    XP.send = function send() {
      try { this.addEventListener('load', onXhrLoad); } catch (_) {}
      return origSend.apply(this, arguments);
    };
  } catch (_) {}

  const origFetch = W.fetch;
  async function sniffResponse(res) {
    if (!res || res.type === 'opaque' || !res.body) return;
    const type = res.headers.get('content-type') || '';
    if (res.status === 206) return recordRanged(res.url, type);
    if (/^(video|audio|image)\//i.test(type)) return;
    if (+res.headers.get('content-length') > MAX_MANIFEST) return;
    const reader = res.clone().body.getReader();
    const first = await reader.read();
    if (first.done || !looksManifest(decoder.decode(first.value.subarray(0, 64)))) { reader.cancel().catch(() => {}); return; }
    const chunks = [first.value];
    let size = first.value.length;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      if ((size += value.length) > MAX_MANIFEST) { reader.cancel().catch(() => {}); return; }
    }
    const all = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    recordManifest(res.url, decoder.decode(all));
  }
  if (typeof origFetch === 'function') {
    W.fetch = function fetch() {
      const p = origFetch.apply(this, arguments);
      // Runs before the page's own .then(), so the body is cloned before the page reads it.
      try { p.then((res) => sniffResponse(res).catch(() => {}), () => {}); } catch (_) {}
      return p;
    };
  }

  function hlsVariantUrls(m) {
    const out = [];
    const lines = m.text.split(/\r?\n/).map((l) => l.trim());
    lines.forEach((l, i) => {
      if (/^#EXT-X-STREAM-INF/i.test(l)) {
        let j = i + 1;
        while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
        if (j < lines.length) out.push(absUrl(lines[j], m.url));
      }
      const uri = /^#EXT-X-MEDIA:.*URI="([^"]+)"/i.exec(l);
      if (uri) out.push(absUrl(uri[1], m.url));
    });
    return out;
  }

  // Which of the playlists the page loaded belongs to this video? Prefer one whose length
  // matches the video (so a pre-roll ad's playlist loses), then the newest master playlist.
  function pickManifest(video) {
    const masters = manifests.filter((m) => m.kind === 'hls-master');
    const medias = manifests.filter((m) => m.kind === 'hls-media');
    const d = video.duration;
    if (isFinite(d) && d > 0) {
      const match = medias.slice().reverse().find((m) => Math.abs(m.duration - d) < Math.max(2, d * 0.01));
      if (match) return masters.slice().reverse().find((ms) => hlsVariantUrls(ms).includes(match.url)) || match;
    }
    return masters[masters.length - 1] || medias[medias.length - 1] ||
      manifests.filter((m) => m.kind === 'dash').pop() || null;
  }

  const urlKind = (u) => (/\.m3u8?(\?|#|$)/i.test(u) ? 'hls' : /\.mpd(\?|#|$)/i.test(u) ? 'dash' : 'file');

  // -> { kind: 'file' | 'hls' | 'dash', url, text? } or null
  function findSource(video) {
    const ok = (u) => u && /^https?:/i.test(u);
    const srcs = [video.currentSrc, video.src, ...[...video.querySelectorAll('source')].map((s) => s.src)];
    for (const u of srcs) {
      if (!ok(u)) continue;
      const kind = urlKind(u);
      const known = manifests.find((m) => m.url === u);
      return { kind: known ? (known.kind === 'dash' ? 'dash' : 'hls') : kind, url: u, text: known && known.text };
    }
    const m = pickManifest(video);
    if (m) return { kind: m.kind === 'dash' ? 'dash' : 'hls', url: m.url, text: m.text };
    if (rangedFiles.length) return { kind: 'file', url: rangedFiles[rangedFiles.length - 1] };
    // Last resort: anything the page requested with a playlist-looking URL.
    const urls = performance.getEntriesByType('resource').map((e) => e.name).reverse();
    const hls = urls.find((u) => /m3u8/i.test(u));
    if (hls) return { kind: 'hls', url: hls };
    const dash = urls.find((u) => /\.mpd(\?|#|$)/i.test(u));
    if (dash) return { kind: 'dash', url: dash };
    return null;
  }

  // A playlist the page built in memory (blob:/data:) is re-created from the text we saw.
  function playableUrl(src) {
    if (/^https?:/i.test(src.url) || !src.text) return src.url;
    return URL.createObjectURL(new Blob([src.text], { type: 'application/vnd.apple.mpegurl' }));
  }

  // ------------------------------------------------------------------ HLS download
  // Fetches every segment of the best-quality stream (decrypting AES-128 if needed) and
  // saves them as one .ts file (or .mp4 for fMP4 streams), which any video player opens.
  function parseAttrs(s) {
    const o = {};
    for (const m of s.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi)) o[m[1].toUpperCase()] = m[2].replace(/^"|"$/g, '');
    return o;
  }
  const hlsLines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const afterColon = (l) => l.slice(l.indexOf(':') + 1);

  function parseMaster(text, base) {
    const variants = [], audio = [];
    const lines = hlsLines(text);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^#EXT-X-STREAM-INF:/i.test(l)) {
        const a = parseAttrs(afterColon(l));
        let j = i + 1;
        while (j < lines.length && lines[j].startsWith('#')) j++;
        if (j < lines.length) {
          const [w, hgt] = (a.RESOLUTION || '0x0').split('x').map(Number);
          variants.push({ url: absUrl(lines[j], base), bw: +a.BANDWIDTH || 0, px: w * hgt, height: hgt, audio: a.AUDIO });
        }
        i = j;
      } else if (/^#EXT-X-MEDIA:/i.test(l)) {
        const a = parseAttrs(afterColon(l));
        if (a.TYPE === 'AUDIO' && a.URI) audio.push({ group: a['GROUP-ID'], url: absUrl(a.URI, base), def: a.DEFAULT === 'YES' });
      }
    }
    variants.sort((x, y) => y.px - x.px || y.bw - x.bw);
    return { variants, audio };
  }

  function parseRange(v, prevEnd) {
    const [len, off] = v.split('@');
    return { len: +len, off: off != null ? +off : prevEnd };
  }

  function parseMedia(text, base) {
    let seq = 0, key = null, map = null, range = null, end = 0;
    const segs = [];
    for (const l of hlsLines(text)) {
      if (/^#EXT-X-MEDIA-SEQUENCE:/i.test(l)) seq = parseInt(afterColon(l), 10) || 0;
      else if (/^#EXT-X-KEY:/i.test(l)) {
        const a = parseAttrs(afterColon(l));
        key = a.METHOD && a.METHOD !== 'NONE' ? { method: a.METHOD, url: a.URI && absUrl(a.URI, base), iv: a.IV } : null;
      } else if (/^#EXT-X-MAP:/i.test(l)) {
        const a = parseAttrs(afterColon(l));
        map = { url: absUrl(a.URI, base), range: a.BYTERANGE ? parseRange(a.BYTERANGE, 0) : null };
      } else if (/^#EXT-X-BYTERANGE:/i.test(l)) range = parseRange(afterColon(l), end);
      else if (!l.startsWith('#')) {
        segs.push({ url: absUrl(l, base), key, map, range, seq: seq + segs.length });
        if (range) end = range.off + range.len;
        range = null;
      }
    }
    return { segs, live: !/#EXT-X-ENDLIST/i.test(text) };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function fetchBytes(url, range) {
    const opts = range ? { headers: { Range: `bytes=${range.off}-${range.off + range.len - 1}` } } : {};
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await origFetch.call(W, url, opts);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      } catch (e) {
        if (attempt >= 3) throw e;
        await sleep(700 * (attempt + 1));
      }
    }
  }
  const fetchText = async (url) => {
    const known = manifests.find((m) => m.url === url);
    return known ? known.text : decoder.decode(await fetchBytes(url));
  };

  async function decryptSeg(data, key, seq, keys) {
    if (!key) return data;
    if (key.method !== 'AES-128') throw new Error(`encrypted with ${key.method} (DRM), can't save`);
    if (!keys.has(key.url)) {
      keys.set(key.url, fetchBytes(key.url).then((raw) => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])));
    }
    const iv = new Uint8Array(16);
    if (key.iv) {
      const hex = key.iv.replace(/^0x/i, '').padStart(32, '0');
      for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.substr(i * 2, 2), 16);
    } else {
      new DataView(iv.buffer).setUint32(12, seq);
    }
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, await keys.get(key.url), data));
  }

  // Some sites disguise MPEG-TS segments as images by gluing junk in front. Skip to the
  // first run of TS sync bytes.
  function stripJunk(u8) {
    if (u8[0] === 0x47 && (u8.length < 189 || u8[188] === 0x47)) return u8;
    const sync = (i) => u8[i] === 0x47 && u8[i + 188] === 0x47 && u8[i + 376] === 0x47;
    // A real PNG in front: walk its chunks to the end of IEND, the TS data starts there.
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
      let o = 8;
      while (o + 12 <= u8.length) {
        const len = ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
        const type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]);
        o += 12 + len;
        if (type === 'IEND') break;
      }
      for (let i = o; i < Math.min(u8.length - 376, o + 1024); i++) if (sync(i)) return u8.subarray(i);
    }
    // Anything else: scan the whole segment for the first run of TS sync bytes.
    for (let i = 0; i < u8.length - 376; i++) if (sync(i)) return u8.subarray(i);
    return u8;
  }


  // In Firefox's content-script sandbox, what XHR hands back can be the *page's* ArrayBuffer.
  // hls.js then dies on it ("Permission denied to access property 'constructor'"). Copy it
  // into a buffer of our own realm, checking each way actually gives a usable buffer.
  const usable = (b) => { try { return b instanceof ArrayBuffer && new Uint8Array(b).subarray(0, 1) && true; } catch (_) { return false; } };
  function toLocalBuffer(d) {
    if (usable(d)) return d;
    const tries = [
      () => { const c = new Uint8Array(d.byteLength); c.set(new Uint8Array(d)); return c.buffer; },
      () => structuredClone(d),
      () => { const src = new Uint8Array(d); const n = src.length; const c = new Uint8Array(n); for (let i = 0; i < n; i++) c[i] = src[i]; return c.buffer; },
    ];
    for (const t of tries) { try { const r = t(); if (usable(r)) return r; } catch (_) {} }
    return d;
  }

  // hls.js loader that makes every response buffer our own (see above) and, for media
  // segments, runs stripJunk so disguised streams play. Stripping is skipped for encrypted
  // segments (can't strip before decrypting) and fMP4 (no TS sync bytes to look for).
  const hlsLoaders = {};
  function hlsLoader(strip) {
    const k = strip ? 'f' : 'p';
    if (hlsLoaders[k] || !HlsLib) return hlsLoaders[k];
    const Base = HlsLib.DefaultConfig.loader;
    return (hlsLoaders[k] = class extends Base {
      load(context, config, callbacks) {
        const onSuccess = callbacks.onSuccess;
        const frag = context.frag;
        const encrypted = frag && frag.decryptdata && frag.decryptdata.method && frag.decryptdata.method !== 'NONE';
        const init = frag && frag.sn === 'initSegment';
        super.load(context, config, Object.assign({}, callbacks, {
          onSuccess(response, stats, ctx, details) {
            try {
              const d = response.data;
              if (d && typeof d === 'object') {
                let buf = toLocalBuffer(d);
                if (strip && !encrypted && !init && usable(buf)) {
                  const u8 = new Uint8Array(buf);
                  const box = u8.length > 8 ? String.fromCharCode(u8[4], u8[5], u8[6], u8[7]) : '';
                  if (!/^(ftyp|styp|moof|sidx|emsg)$/.test(box)) {
                    const st = stripJunk(u8);
                    if (st !== u8) buf = st.slice().buffer;
                  }
                }
                if (buf !== d) response.data = buf;
              }
            } catch (_) {}
            onSuccess(response, stats, ctx, details);
          },
        }));
      }
    });
  }

  function segExt(media) {
    const s = media.segs[0];
    if (s.map) return 'mp4';
    const e = (/\.([a-z0-9]{2,4})(\?|#|$)/i.exec(new URL(s.url).pathname) || [])[1];
    return ['aac', 'mp3', 'ac3', 'ec3'].includes((e || '').toLowerCase()) ? e.toLowerCase() : 'ts';
  }

  async function grabMedia(media, job, label) {
    const n = media.segs.length;
    const parts = new Array(n);
    const keys = new Map();
    let next = 0, done = 0;
    async function worker() {
      while (next < n) {
        if (job.cancelled) throw new Error('cancelled');
        const i = next++;
        const s = media.segs[i];
        let b = await decryptSeg(await fetchBytes(s.url, s.range), s.key, s.seq, keys);
        if (!s.map) b = stripJunk(b);
        parts[i] = new Blob([b]);
        job.progress(label, ++done, n);
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, n) }, worker));
    const map = media.segs[0].map;
    if (map) parts.unshift(new Blob([await fetchBytes(map.url, map.range)]));
    const ext = segExt(media);
    return { blob: new Blob(parts, { type: ext === 'mp4' ? 'video/mp4' : 'video/mp2t' }), ext };
  }

  function saveBlob(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.style.display = 'none';
    a.addEventListener('click', (e) => e.stopImmediatePropagation());
    document.documentElement.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5 * 60 * 1000);
  }

  const fileName = () => ((document.title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'video');

  async function downloadHls(src, job) {
    const text = src.text || await fetchText(src.url);
    let mediaUrl = src.url, mediaText = text, audioUrl = null, quality = '';
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const m = parseMaster(text, src.url);
      if (!m.variants.length) throw new Error('empty playlist');
      const best = m.variants[0];
      mediaUrl = best.url;
      quality = best.height ? ` ${best.height}p` : '';
      mediaText = await fetchText(mediaUrl);
      if (best.audio) {
        const group = m.audio.filter((a) => a.group === best.audio);
        const a = group.find((x) => x.def) || group[0];
        if (a) audioUrl = a.url;
      }
    }
    const media = parseMedia(mediaText, mediaUrl);
    if (!media.segs.length) throw new Error('empty playlist');
    const name = fileName() + quality;
    const v = await grabMedia(media, job, audioUrl ? 'video' : '');
    saveBlob(v.blob, `${name}.${v.ext}`);
    if (audioUrl) {
      const a = await grabMedia(parseMedia(await fetchText(audioUrl), audioUrl), job, 'audio');
      saveBlob(a.blob, `${name} (audio).${a.ext}`);
      return { live: media.live, split: true };
    }
    return { live: media.live, split: false };
  }

  let dlJob = null;
  async function download(video, toast) {
    if (dlJob) { dlJob.cancelled = true; return; } // second tap cancels
    const src = findSource(video);
    if (!src) return toast("Couldn't find the video's source. Play it for a few seconds, then try again.");
    if (src.kind === 'file') {
      W.open(src.url, '_blank');
      return toast('Opened the video file. Long-press it (or use ⋮) to save.');
    }
    if (src.kind === 'dash') {
      try { await navigator.clipboard.writeText(src.url); toast('DASH stream: can\'t save it, manifest URL copied.'); } catch (_) { toast("DASH stream: can't save this one."); }
      return;
    }
    const job = dlJob = {
      cancelled: false,
      progress: (label, d, n) => toast(`Downloading${label ? ` ${label}` : ''} ${Math.floor((d / n) * 100)}% (${d}/${n}). Tap ⬇ again to cancel.`, true),
    };
    toast('Reading the stream…', true);
    try {
      const r = await downloadHls(src, job);
      toast(r.split ? 'Saved. This stream keeps audio separate, so you got two files: video and audio.'
        : r.live ? 'Saved what this live stream has so far.' : 'Saved. Check your downloads.');
    } catch (e) {
      toast(job.cancelled ? 'Download cancelled.' : `Download failed: ${e.message || e}`);
    } finally {
      dlJob = null;
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
    // Toasts live in their own host so they stay visible while the bar is hidden.
    const toastHost = h('div', { 'data-video-gestures': 'toast' });
    toastHost.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    const toastRoot = toastHost.attachShadow({ mode: 'closed' });
    const toastStyle = document.createElement('style');
    toastStyle.textContent = BAR_CSS;
    const toastEl = h('div', { class: 'toast' });
    toastRoot.append(toastStyle, toastEl);
    let toastTimer = 0;
    const toast = (msg, sticky) => {
      if (!toastHost.isConnected) document.documentElement.append(toastHost);
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      if (!sticky) toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4000);
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
    root.append(style, bar);
    for (const t of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
      hostEl.addEventListener(t, (e) => e.stopPropagation());
    }

    function place() {
      if (!hostEl.isConnected) document.documentElement.append(hostEl);
      video = fsEl() || overlay ? null : pickVideo(document.getElementsByTagName('video'), { minSize: true, skip: dismissed });
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
      flex-wrap: wrap; justify-content: center; max-width: 88vw; box-sizing: border-box; text-align: center;
      opacity: 0; transition: opacity .15s; pointer-events: none;
    }
    .bubble.show { opacity: 1; }
    .bubble .sub:empty { display: none; }
    .bubble .sub { opacity: .75; font-weight: 500; font-size: 14px; white-space: normal; flex: 1 1 100%; min-width: min(72vw, 380px); overflow-wrap: anywhere; }
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
    button.tag { min-width: 0; height: 30px; padding: 0 12px; font-size: 12px; }
    .tag { flex: none; padding: 4px 8px; border-radius: 999px; background: rgba(255,255,255,.18); font-size: 11px; font-weight: 600; white-space: nowrap; }
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

  // Sites where our HLS player couldn't play the stream: go straight to the site's player there.
  const FAIL_KEY = 'videoGestures.ownFailed';
  const ownFailedHere = () => { try { return localStorage.getItem(FAIL_KEY) === '1'; } catch (_) { return false; } };
  const markOwnFailed = () => { try { localStorage.setItem(FAIL_KEY, '1'); } catch (_) {} };
  const clearOwnFailed = () => { try { localStorage.removeItem(FAIL_KEY); } catch (_) {} };

  function mountOverlay(container, source, opts = {}) {
    if (overlay && overlay.container === container && overlay.source === source) return;
    teardownOverlay();

    // Own-player mode: play the video's real source (a plain file, or the HLS playlist the
    // page loaded) in our own <video> inside a closed shadow root. Page scripts have no way
    // to reach it, so they can't pause it, seek it, starve its buffer or swap its source.
    // The site's video is paused and muted underneath.
    const src = opts.noDirect ? null : findSource(source);
    const hlsJs = !!(HlsLib && HlsLib.isSupported && HlsLib.isSupported());
    // In Firefox's content-script sandbox hls.js mixes page and sandbox objects and Firefox
    // blocks it (black screen), so there HLS goes to the site's player unless Firefox plays it natively.
    const hlsBlocked = !!src && src.kind === 'hls' && ((sandboxed && !canNativeHls()) || (ownFailedHere() && !opts.retryOwn));
    const direct = !!src && (src.kind === 'file' || (src.kind === 'hls' && !hlsBlocked && (hlsJs || canNativeHls())));
    if (hlsBlocked && !opts.notice) opts = Object.assign({}, opts, sandboxed
      ? { notice: "Own player can't run here", why: 'Firefox sandboxed the script (page CSP)' }
      : { notice: 'Our player failed on this site before', why: 'tap the tag to retry' });
    const video = direct ? h('video', { class: 'own', playsinline: '', preload: 'auto' }) : source;
    let hls = null;

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
    const modeTag = h('button', { class: 'tag', title: direct ? 'Our own player. Tap to switch to the site\'s player'
      : 'The site\'s player. Tap to try our own player' },
      direct ? (src.kind === 'hls' ? 'Own player · HLS' : 'Own player · file') : 'Site player');
    const speedBtn = h('button', { title: 'Speed' }, '1×');
    const rotateBtn = h('button', { title: 'Rotate screen' }, icon(ICON.rotate));
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
      h('div', { class: 'top' }, title, modeTag, speedBtn, rotateBtn, exitBtn),
      h('div', { class: 'mid' }, backBtn, playBtn, fwdBtn),
      h('div', { class: 'bottom' }, cur, track, dur));

    root.append(style, h('div', { class: 'wrap' }, direct ? video : null, dim, layer, ripL, ripR, hud, bubble));
    container.append(hostEl);

    // If page code yanks our overlay out while still fullscreen, put it back.
    const reattach = new MutationObserver(() => {
      if (!hostEl.isConnected && overlay && overlay.container === container) container.append(hostEl);
    });
    reattach.observe(container, { childList: true });

    let userPaused = false;
    let userTappedPause = false; // only the user's own pause, not a refused play()
    const play = () => { userPaused = false; userTappedPause = false; return realPlay(video).catch(() => { userPaused = true; }); };
    const pause = () => { userPaused = true; userTappedPause = true; realPause(video); };

    // Whatever pauses the video (page code, a site player holding the real pause(), a
    // focus/visibility handler), resume it unless it was the user.
    video.addEventListener('pause', () => {
      setTimeout(() => {
        if (overlay && overlay.video === video && !userPaused && video.paused && !video.ended) realPlay(video).catch(() => {});
      }, 0);
    }, sig);

    const sourceMuted = source.muted;
    let stallCheck = 0;
    let lastErr = '';
    const errLog = [];
    let firstFrame = false;
    if (direct) {
      const startAt = source.currentTime;
      video.playbackRate = source.playbackRate || 1;
      video.volume = source.volume;
      video.muted = source.muted;
      // Silence the site's copy and keep it stopped, however hard the page tries.
      source.muted = true;
      realPause(source);
      source.addEventListener('play', () => { source.muted = true; realPause(source); }, sig);
      // If the source won't load in our player (e.g. a link that only works inside the
      // site's player), fall back to guarding the site's own video.
      const fallBack = (why) => {
        if (!overlay || overlay.video !== video) return;
        if (src.kind === 'hls' && !firstFrame) markOwnFailed();
        teardownOverlay();
        mountOverlay(container, source, { noDirect: true, notice: "Couldn't play the stream in our player", why: why || lastErr });
      };
      video.addEventListener('error', () => {
        const e = video.error;
        fallBack(e ? `media error ${e.code}${e.message ? `: ${e.message}` : ''}` : 'media error');
      }, sig);
      if (src.kind === 'hls' && hlsJs) {
        let recovered = false;
        let noWorkerRetry = false;
        const startHls = (worker) => {
          hls = new HlsLib({ startPosition: startAt > 0 ? startAt : -1, loader: hlsLoader(false) || undefined, fLoader: hlsLoader(true) || undefined, enableWorker: worker });
          hls.on(HlsLib.Events.MANIFEST_PARSED, () => play());
          hls.on(HlsLib.Events.ERROR, (_, d) => {
            const code = d.response && d.response.code;
            const raw = d.error && d.error.message ? String(d.error.message) : d.reason ? String(d.reason) : '';
            // Firefox sandbox trouble from hls.js's worker: start over without the worker, once.
            if (worker && !noWorkerRetry && /Xray|cross-origin object/i.test(raw)) {
              noWorkerRetry = true;
              const h0 = hls;
              setTimeout(() => { try { h0.destroy(); } catch (_) {} if (overlay && overlay.video === video) startHls(false); }, 0);
              return;
            }
            let where = '';
            try { // first stack frame, so a screenshot shows which line failed
              const f = String((d.error && d.error.stack) || '').split('\n').find((l) => /:\d+:\d+/.test(l));
              if (f) where = ` @ ${(/([^/@\s]+:\d+:\d+)\)?\s*$/.exec(f) || [])[1] || ''}`;
            } catch (_) {}
            const e = `${d.details}${d.event ? ` in ${d.event}` : ''}${code ? ` (HTTP ${code})` : ''}${raw ? `: ${raw.slice(0, 140)}` : ''}${where}`;
            if (!errLog.includes(e)) errLog.push(e);
            lastErr = errLog.slice(-3).join(' → ');
            if (!firstFrame) showBubble(null, 'Loading stream…', { sub: `${lastErr}${worker ? '' : ' [no worker]'}`, sticky: true });
            // Can't parse this site's segments (custom scrambling only its own player undoes):
            // waiting won't help, hand over now.
            if (!firstFrame && d.details === 'fragParsingError') { fallBack(lastErr); return; }
            if (!d.fatal) return;
            if (d.type === HlsLib.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
            fallBack(lastErr);
          });
          hls.loadSource(playableUrl(src));
          hls.attachMedia(video);
        };
        startHls(!sandboxed);
      } else {
        video.addEventListener('loadedmetadata', () => {
          if (startAt > 0 && (!isFinite(video.duration) || startAt < video.duration)) video.currentTime = startAt;
        }, { once: true, signal: ac.signal });
        video.src = src.kind === 'hls' ? playableUrl(src) : src.url;
        play();
      }
      // Watchdog: if our player never shows a frame (segments it can't decode, a server
      // that refuses us), don't leave a black screen; hand back to the site's player.
      const t0 = Date.now();
      stallCheck = setInterval(() => {
        if (!overlay || overlay.video !== video) return clearInterval(stallCheck);
        if (video.readyState >= 2 && video.currentTime > startAt) {
          firstFrame = true;
          bubble.classList.remove('show');
          return clearInterval(stallCheck);
        }
        if (userTappedPause) return;
        if (video.paused) realPlay(video).catch(() => {}); // a refused/aborted play() mustn't leave us stuck
        if (Date.now() - t0 > 8000) { clearInterval(stallCheck); fallBack(lastErr || `no picture after 8s (state ${video.readyState})`); }
      }, 1000);
    } else if (opts.notice) {
      play(); // our player gave up; get the site's copy going again
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
      if (!opts.sticky) bubbleTimer = setTimeout(() => bubble.classList.remove('show'), opts.ms || 700);
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
    if (direct) showBubble(null, 'Loading stream…', { sub: 'tap the tag at the top to use the site\'s player', sticky: true });
    else if (opts.notice) showBubble(null, opts.notice, { sub: opts.why ? `${opts.why} · using the site's player` : "using the site's player", ms: opts.why ? 6000 : 3000 });

    modeTag.addEventListener('click', () => {
      teardownOverlay();
      if (direct) mountOverlay(container, source, { noDirect: true, notice: "Switched to the site's player" });
      else { clearOwnFailed(); mountOverlay(container, source, { retryOwn: true }); }
    }, sig);

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

    // --- orientation: landscape for wide videos, until the user picks one with the rotate button
    let manualOrientation = false;
    function lockOrientation() {
      try {
        if (manualOrientation || !video.videoWidth) return;
        const want = video.videoWidth >= video.videoHeight ? 'landscape' : 'portrait';
        screen.orientation.lock(want).catch(() => {});
      } catch (_) {}
    }
    lockOrientation();
    rotateBtn.addEventListener('click', () => {
      showHud();
      const now = (screen.orientation && screen.orientation.type) || (innerWidth > innerHeight ? 'landscape' : 'portrait');
      const want = now.startsWith('landscape') ? 'portrait' : 'landscape';
      manualOrientation = true;
      let p;
      try { p = screen.orientation.lock(want); } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(
        () => showBubble(ICON.rotate, want === 'landscape' ? 'Landscape' : 'Portrait'),
        () => showBubble(ICON.rotate, "Can't rotate here", { sub: 'browser blocked it' }));
    }, sig);
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
          if (hls) hls.destroy();
          video.removeAttribute('src');
          video.load();
        }
        clearInterval(swapCheck);
        clearInterval(stallCheck);
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

  // When the page fullscreens an <iframe> (embedded players), the video lives in that
  // frame, where this script also runs. Tell it to take over its whole page.
  let fsFrame = null;
  const tellFrame = (frame, on) => { try { frame.contentWindow.postMessage({ __videoGestures: 'frame-fs', on }, '*'); } catch (_) {} };

  function onFullscreenChange() {
    const el = fsEl();
    if (fsFrame && fsFrame !== el) { tellFrame(fsFrame, false); fsFrame = null; }
    if (!el) { teardownOverlay(); if (floatingBar) floatingBar.place(); return; }
    if (el.tagName === 'VIDEO') return; // bare video fullscreen (e.g. browser's own controls): no room for an overlay
    if (el.tagName === 'IFRAME') { fsFrame = el; tellFrame(el, true); return; }
    const video = el.querySelector(`video[${ACTIVE_ATTR}]`) || pickVideo(el.querySelectorAll('video'));
    if (video) mountOverlay(el, video);
  }

  W.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || !d.__videoGestures) return;
    if (d.__videoGestures === 'frame-fs' && e.source === W.parent) {
      if (!d.on) { if (!fsEl()) teardownOverlay(); return; }
      const video = document.querySelector(`video[${ACTIVE_ATTR}]`) || pickVideo(document.getElementsByTagName('video'));
      if (video && !fsEl()) mountOverlay(document.documentElement, video);
    } else if (d.__videoGestures === 'exit' && fsFrame && e.source === fsFrame.contentWindow) {
      const f = origExitFs.exitFullscreen || origExitFs.mozCancelFullScreen;
      if (f) f.call(document);
    }
  });

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
