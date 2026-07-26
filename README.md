# artkiosk

Static GitHub Pages site of generative art sketches (p5.js), meant to be
streamed full-screen from devices around the house/office as a kind of
digital art kiosk.

- `index.html` — kiosk view. Fetches `sketches/manifest.json` and auto-rotates
  through every sketch full-screen, no UI chrome. Point a device's browser at
  this page (e.g. as its home page in kiosk mode) and leave it running.
- `gallery.html` — human-browsable grid of all sketches with live previews,
  for picking one to look at directly.
- `sketches/<name>/index.html` — one self-contained p5.js sketch per folder.
  Each sketch fills the window it's given (`createCanvas(windowWidth,
  windowHeight)` + a `windowResized` handler) so it works both standalone and
  embedded in an iframe.
- `sketches/manifest.json` — list of `{ id, title, path, description }`
  entries. Add an entry here whenever a new sketch is added; both `index.html`
  and `gallery.html` read from it.

## Adding a new sketch

1. `mkdir sketches/<name>` and add an `index.html` there (p5.js, full-window
   canvas, no external dependencies beyond the p5.js CDN script).
2. Add an entry to `sketches/manifest.json`.
3. Commit and push — GitHub Pages picks it up automatically.

## Pointing a device at the kiosk

Set the device's browser to open in full-screen/kiosk mode at the Pages URL
for `index.html`. The rotation interval is set by `ROTATE_MS` near the top of
that file's script.
