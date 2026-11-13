# Republic Labs: interactive deck

A slide deck built on a live WebGL turntable (record, tonearm and label are rendered in the browser).

- Live: https://vinyl-republic.vercel.app
- Run locally: `python3 -m http.server 8892`, then open http://127.0.0.1:8892/deck.html
- Arrow keys / nav (bottom right) change slides; space starts and stops the record.
- Extras: `sandbox.html` (free camera, H hides the UI), `scene.html` (needle drop), `deck.html?record` (records a walkthrough video).

Turntable renderer adapted from rauchg/vinyl (MIT, see LICENSE-vinyl-renderer.txt). Photo credits in assets/pfp/CREDITS.txt; od-live.jpg and od-portrait.jpg are CC BY-SA, Harald Krichel.
