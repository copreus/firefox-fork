# Video Gestures (userscript)

A Quetta/Aloha-style video experience for Firefox for Android, as a Tampermonkey script.

## Install
1. In Firefox for Android, install **Tampermonkey** (or Violentmonkey) from addons.mozilla.org.
2. Open this link and tap **Install**:
   https://raw.githubusercontent.com/copreus/firefox-fork/ccr-4461f63e-19zvzq/video-gestures.user.js

Tampermonkey checks that link for updates automatically.

## What it does
**Floating bar** under the main video on any page: speed · download · fullscreen · hide.

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
- Download only works for plain video files. Streamed video (HLS/DASH, most big sites) can't be saved directly; the script copies the playlist URL instead.
