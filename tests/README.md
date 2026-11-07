# Focused signaling URL regression checks

Run `node --test tests/websocket-scheme.test.js` with Node.js 18 or newer.

These dependency-free tests evaluate the inline scripts from both actual pages,
including the client's Connect callback, with inert DOM, jQuery, WebSocket and
timer boundaries. They cover HTTP and HTTPS, default and explicit ports, and
query/fragment exclusion from the signaling URL. They do not start capture,
open network sockets, or launch the Docker app.

Browser rendering, form submission, real signaling, WebRTC/media, and the
Chromium/FFmpeg/PulseAudio container workflow still need integration testing.
