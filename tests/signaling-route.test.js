// Run with Node 22+ and Python containing Flask and Flask-Sockets:
// PYTHON=/path/to/python node --test tests/signaling-route.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let child;
let port;
let output = '';
let errors = '';

before(async () => {
  // Import the complete production module. Only the listening address/port
  // differ from its CLI: use a disposable loopback port for these tests.
  child = spawn(process.env.PYTHON || 'python3', ['-u', '-c', `
import serve
from gevent import pywsgi
from geventwebsocket.handler import WebSocketHandler
server = pywsgi.WSGIServer(('127.0.0.1', 0), serve.app, handler_class=WebSocketHandler)
server.start()
print('TEST_PORT=' + str(server.server_port), flush=True)
server.serve_forever()
`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', data => { errors += data; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 10000);
    const finish = error => {
      clearTimeout(timer);
      child.off('exit', exited);
      child.off('error', failed);
      error ? reject(error) : resolve();
    };
    const exited = code => finish(new Error(`Server exited ${code}: ${errors}`));
    const failed = error => finish(error);
    child.once('exit', exited);
    child.once('error', failed);
    child.stdout.on('data', data => {
      output += data;
      const match = /TEST_PORT=(\d+)/.exec(output);
      if (match && !port) {
        port = Number(match[1]);
        finish();
      }
    });
  });
});

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
});

async function peer(t) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/echo`);
  const messages = [];
  let waiter;
  let closed = false;
  ws.addEventListener('message', event => {
    if (waiter) waiter(null, event.data);
    else messages.push(event.data);
  });
  ws.addEventListener('close', () => {
    closed = true;
    if (waiter) waiter(new Error(`Signaling closed before delivery: ${errors}`));
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 3000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(errors)); }, { once: true });
  });
  t.after(() => ws.close());
  return {
    ws,
    messages,
    send: data => ws.send(JSON.stringify(data)),
    next: () => new Promise((resolve, reject) => {
      if (messages.length) return resolve(messages.shift());
      if (closed) return reject(new Error(`Signaling already closed: ${errors}`));
      const timer = setTimeout(() => waiter(new Error(`Signaling delivery timed out: ${errors}`)), 3000);
      waiter = (error, data) => {
        clearTimeout(timer);
        waiter = undefined;
        error ? reject(error) : resolve(data);
      };
    }),
  };
}

test('ordinary static HTTP routes retain exact bytes', async () => {
  for (const file of ['client.html', 'broadcast.html', 'js/jquery-3.3.1.min.js']) {
    const response = await fetch(`http://127.0.0.1:${port}/${file}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path.join(root, 'static', file)));
  }
});

test('HTTP requests to the signaling path still fall through to Flask', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/echo`);
  assert.equal(response.status, 404);
  assert.doesNotMatch(errors, /WebsocketMismatch/);
});

test('WebSocket registration supports bidirectional signaling and reconnects', async t => {
  const server = await peer(t);
  server.send({ type: 'server_hello' });
  // A round trip on the same connection confirms registration before clients
  // on other connections can send offers.
  const ready = { type: 'candidate', target: 'server', id: 'ready' };
  server.send(ready);
  assert.equal(await server.next(), JSON.stringify(ready));
  const clients = [await peer(t), await peer(t)];
  for (let i = 0; i < clients.length; ++i) {
    clients[i].send({ type: 'client_hello' });
    const message = { type: 'offer', target: 'server', id: i, text: 'hello 🌍' };
    clients[i].send(message);
    assert.equal(await server.next(), JSON.stringify(message));
  }

  const reply = { type: 'answer', target: 'clients', sdp: 'synthetic SDP' };
  server.send(reply);
  for (const client of clients) assert.equal(await client.next(), JSON.stringify(reply));

  const candidate = { type: 'candidate', target: 'clients', candidate: 'synthetic ICE' };
  clients[0].send(candidate);
  assert.equal(await clients[1].next(), JSON.stringify(candidate));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(clients[0].messages, [], 'sender is not echoed its own broadcast');

  const closed = once(clients[0].ws, 'close');
  clients[0].ws.close();
  await closed;
  const replacement = await peer(t);
  replacement.send({ type: 'client_hello' });
  const reconnect = { type: 'offer', target: 'server', id: 'replacement' };
  replacement.send(reconnect);
  assert.equal(await server.next(), JSON.stringify(reconnect));
  server.send(reply);
  assert.equal(await replacement.next(), JSON.stringify(reply));
  assert.equal(await clients[1].next(), JSON.stringify(reply));
  assert.doesNotMatch(errors, /WebsocketMismatch/);
});
