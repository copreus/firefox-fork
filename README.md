# Video Gestures (userscript)

A Quetta/Aloha-style video experience for Firefox for Android, as a Tampermonkey script.

## Install
1. In Firefox for Android, install **Tampermonkey** (or Violentmonkey) from addons.mozilla.org.
2. Open this link and tap **Install**:
   https://raw.githubusercontent.com/copreus/firefox-fork/ccr-01175c86-4gdter/video-gestures.user.js

Tampermonkey checks that link for updates automatically.

## What it does
**Floating bar** under the main video on any page: speed · download · fullscreen · hide.

**Fullscreen player the page can't stop.** When the site's video is a plain file (an .mp4 link, etc.),
fullscreen plays that file in the script's own video element, sealed away from the page. The page's
scripts can't pause, seek or swap it, and can't kick you out of fullscreen. The site's copy is paused and
muted underneath, and when you leave fullscreen it picks up where you stopped. If the site streams in
pieces (no single file), the script keeps the site's video but ignores any pause that didn't come from you.

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

## Limits
- Volume is the video's own volume, and brightness can only dim (real system volume/brightness needs a Firefox fork).
- In fullscreen, everything but the video is hidden — including the site's own captions (captions built into the video file still show).
- If a page fullscreens the bare `<video>` through Firefox's built-in controls, there's no room for the overlay. The script redirects the sites' own fullscreen calls, so this mostly only affects Firefox's native video controls.
- If the direct file won't play outside the site's player (some links expire or check where they're
  played from), the script falls back to the site's own video, still with pause-blocking.
- Download only works for plain video files. Streamed video (HLS/DASH, most big sites) can't be saved directly; the script copies the playlist URL instead.
