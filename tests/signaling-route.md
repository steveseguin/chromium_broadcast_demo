# Signaling route regression

Run from the repository root with Node 22 or later and Python containing the
server's existing `Flask` and `Flask-Sockets` dependencies:

```sh
PYTHON=/path/to/python node --test tests/signaling-route.test.js
```

If `PYTHON` is omitted, the test uses `python3`. No npm packages are required.
The test launches the complete `serve` module using its normal gevent WSGI
server and WebSocket handler. It substitutes only a disposable loopback address
and port, rather than using the CLI's fixed port 5000. It terminates the server
afterward and sends only synthetic signaling messages.

Coverage includes static HTTP response bytes, HTTP fallback at `/echo`, actual
WebSocket registration, client-to-broadcaster messages, broadcaster-to-clients
messages, sender exclusion, disconnects and reconnection. Receiving a WebSocket
open event alone is not enough: the assertions require delivered payloads.

The production fix registers an additional WebSocket rule because
Flask-Sockets 0.2.1 ignores route options. The original HTTP rule remains so
ordinary requests still fall through to Flask. The additional rule is skipped
on older Werkzeug versions without the `websocket` property.

Validated on Linux with Python 3.12, Flask 3.1.3, Flask-Sockets 0.2.1,
Werkzeug 3.1.9, gevent 26.9.0, gevent-websocket 0.10.1 and Node 24.22.1.
This is local signaling validation, not a browser, TLS, WebRTC/media, capture,
Ubuntu 18.04 container or deployed-service test. Older Werkzeug routing is
preserved by the capability guard but has not been runtime-tested here.
