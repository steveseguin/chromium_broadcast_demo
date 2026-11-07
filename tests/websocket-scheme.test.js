const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Evaluate the actual inline page scripts. Network, media and timers are inert.
function connectPage(page, pageUrl) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'static', page), 'utf8');
  const location = new URL(pageUrl);
  const opened = [];
  const clickHandlers = new Map();
  const elements = new Map();
  const context = vm.createContext({
    window: { location },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: 'test-user' });
        return elements.get(id);
      },
    },
    console: { log() {} },
    alert(message) { throw new Error(message); },
    setInterval() {},
    setTimeout() {},
    WebSocket: class {
      constructor(url) { opened.push(url); }
    },
    $(selector) {
      const selection = {
        addClass() { return selection; },
        removeClass() { return selection; },
        attr() { return selection; },
        click(handler) { clickHandlers.set(selector, handler); },
      };
      return selection;
    },
  });
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1])) {
      vm.runInContext(match[2], context, { filename: page });
    }
  }
  if (page === 'client.html') clickHandlers.get('#connect')();
  assert.equal(opened.length, 1, 'the page opens exactly one signaling socket');
  return opened[0];
}

for (const page of ['client.html', 'broadcast.html']) {
  for (const [pageUrl, expected] of [
    ['http://localhost:5000/' + page, 'ws://localhost:5000/echo'],
    ['https://demo.example/' + page, 'wss://demo.example/echo'],
    ['http://demo.example:8080/' + page + '?room=test#view', 'ws://demo.example:8080/echo'],
    ['https://demo.example:8443/' + page + '?room=test#view', 'wss://demo.example:8443/echo'],
  ]) {
    test(`${page} uses the page scheme and host for ${pageUrl}`, () => {
      assert.equal(connectPage(page, pageUrl), expected);
    });
  }
}
