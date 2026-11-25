# Video Gestures (userscript)

A Quetta/Aloha-style video experience for Firefox for Android, as a Tampermonkey script.

## Install
1. In Firefox for Android, install **Tampermonkey** (or Violentmonkey) from addons.mozilla.org.
2. Open this link and tap **Install**:
   https://raw.githubusercontent.com/copreus/firefox-fork/ccr-4461f63e-19zvzq/video-gestures.user.js

Tampermonkey checks that link for updates automatically.

## What it does
**Floating bar** under the main video on any page: speed · download · fullscreen · hide.

**Fullscreen player the page can't stop.** In fullscreen the script plays the video's real source in
its own player, sealed away from the page, so the site's scripts can't pause it, cut off its stream or
kick you out of fullscreen. The site's copy is paused and muted underneath, and when you leave fullscreen
it picks up where you stopped.
- Works with plain files (.mp4 etc.) and **HLS streams** (`.m3u8` playlists, via hls.js), including
  playlists hidden behind URLs that don't end in `.m3u8`. The script spots them by their content as
  the page loads them, the way a network sniffer does.
- A tag in the top bar shows which player you're on: **Own player · HLS**, **Own player · file**, or
  **Site player** (it couldn't find or load the source, so it's protecting the site's video instead,
  blocking pauses but unable to stop the site from cutting its own stream).
- Also works when the page fullscreens an embedded player `<iframe>`.

**Download** (⬇ on the floating bar): plain files open for saving. HLS streams are downloaded
segment by segment at the best quality, decrypted if they use AES-128, and saved as one `.ts` (or
`.mp4`) file that VLC, MX Player etc. play. Progress shows at the bottom; tap ⬇ again to cancel.

**Fullscreen gestures**
| Gesture | Action |
|---|---|
| Drag left/right anywhere | Seek (full-width swipe = up to 2 min) |
| Drag up/down, left half | Dim / brighten the video |
| Drag up/down, right half | Volume |
| Double-tap left / right | −10s / +10s (keep tapping to keep skipping) |
| Double-tap centre | Play / pause |
| Press and hold | 2× speed while held |
| Single tap | Show / hide controls |

The top bar has speed, **rotate** (switch between landscape and portrait) and exit buttons.

## Limits
- Volume is the video's own volume, and brightness can only dim (real system volume/brightness needs a Firefox fork).
- In fullscreen, everything but the video is hidden — including the site's own captions (captions built into the video file still show).
- If a page fullscreens the bare `<video>` through Firefox's built-in controls, there's no room for the overlay. The script redirects the sites' own fullscreen calls, so this mostly only affects Firefox's native video controls.
- If the direct file won't play outside the site's player (some links expire or check where they're
  played from), the script falls back to the site's own video, still with pause-blocking.
- DASH streams (`.mpd`) can't be played in the own player or downloaded; the script copies the manifest URL. DRM-protected video (Netflix etc.) can't be either.
- Streams that keep audio as a separate track download as two files (video + audio).
- An HLS download is held in memory until it's saved, so very long, high-quality videos can be too big for a phone.
- Play the video for a few seconds before downloading or fullscreening, so the script sees the playlist load.
