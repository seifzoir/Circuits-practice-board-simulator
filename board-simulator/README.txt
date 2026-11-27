PC Basic Electronic Board 1017.1 USB - Simulator

HOW TO RUN (the page uses ES modules, so it must be served, not opened by double-click):
  Option 1 (VS Code): install the "Live Server" extension, right-click index.html -> "Open with Live Server".
  Option 2 (Python):  open a terminal in this folder and run:  python -m http.server 3000
                      then open http://localhost:3000
  Option 3 (Node):    npx serve -l 3000

This folder replaces both the old "board simulator" folder and its nested "pc-basic-board-1017" copy.

PHONE / TABLET
  Serve the folder from a computer on your Wi-Fi (python -m http.server 3000), then open
  http://<your-computer-IP>:3000 on the phone. Or upload the folder to any static host (Netlify, Vercel, GitHub Pages).
  Pinch = zoom, two fingers = pan, one finger on empty space = pan.
  Touch near a socket and drag to draw a wire. Tap a part for rotate / edit / delete buttons.
  "+ Parts" opens the parts drawer (swipe a part sideways onto the board). "+ Meter" adds a multimeter.
