// Real Chromium smoke test of the static export with NO Supabase configuration.
// This checks rendered layout/setup states, not live authentication or RLS.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve('out');
const profile = await mkdtemp(resolve(tmpdir(), 'asc-browser-'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('outside export');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    response.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let chrome;
let socket;
let sequence = 0;
const pending = new Map();
try {
  chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', [
    '--headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not expose a debugging endpoint.')), 15000);
    chrome.once('error', (error) => { clearTimeout(timer); reject(error); });
    chrome.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited before setup (${code}).`)); });
    chrome.stderr.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(message.id);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
  });
  await new Promise((opened, reject) => {
    socket.addEventListener('open', opened, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  function send(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise((resolveCall, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve: resolveCall, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  // Do not send requests to real third-party services during a local layout test.
  await call('Network.setBlockedURLs', { urls: ['https://*'] });
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}; evaluating: ${expression}`);
    return result.result.value;
  }
  async function navigate(url) {
    // Page.navigate returns before DOM readiness; wait for this navigation's load event.
    const loaded = new Promise((resolveLoad, reject) => {
      const onMessage = ({ data }) => {
        const event = JSON.parse(data);
        if (event.sessionId === sessionId && event.method === 'Page.loadEventFired') {
          clearTimeout(timer);
          socket.removeEventListener('message', onMessage);
          resolveLoad();
        }
      };
      const timer = setTimeout(() => {
        socket.removeEventListener('message', onMessage);
        reject(new Error(`Page load timed out: ${url}`));
      }, 15000);
      socket.addEventListener('message', onMessage);
    });
    await Promise.all([call('Page.navigate', { url }), loaded]);
  }
  let checks = 0;
  for (const width of [390, 721, 900, 1100, 1280]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(`${base}/member/login/`);
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      ready = await evaluate(`(() => {
        const text = document.body?.innerText ?? '';
        const button = document.querySelector('form button[type="submit"]');
        return text.includes('Member 연결 설정이 필요합니다.') || button?.textContent?.trim() === '로그인';
      })()`);
      if (ready) break;
      await sleep(100);
    }
    assert.equal(ready, true, `member login settles at ${width}px`);
    const ui = await evaluate(`(() => {
      const text = document.body?.innerText ?? '';
      const setupMode = text.includes('Member 연결 설정이 필요합니다.');
      const visible = (element) => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && getComputedStyle(element).visibility !== 'hidden'; };
      const member = [...document.querySelectorAll('header a')].find((element) => element.textContent === 'Member' && visible(element));
      const apply = [...document.querySelectorAll('header button')].find((element) => element.textContent.includes('Apply Us') && visible(element));
      const form = document.querySelector('form').getBoundingClientRect();
      return {
        setupMode,
        inputsDisabled: [...document.querySelectorAll('form input')].every((element) => element.disabled),
        formFits: form.left >= 0 && form.right <= innerWidth,
        background: getComputedStyle(document.body).backgroundColor,
        headerMember: !!member,
        headerClear: member && apply ? member.getBoundingClientRect().right <= apply.getBoundingClientRect().left : null,
        mainClear: document.querySelector('main').getBoundingClientRect().top + parseFloat(getComputedStyle(document.querySelector('main')).paddingTop) > document.querySelector('header').getBoundingClientRect().bottom,
        noSignup: !document.querySelector('form').innerText.includes('회원가입')
      };
    })()`);
    assert.equal(ui.inputsDisabled, ui.setupMode, `configured signed-out login is usable and unconfigured login is disabled (${width})`);
    assert.equal(ui.formFits, true, `form fits (${width})`);
    assert.equal(ui.mainClear, true, `fixed header clears main (${width})`);
    assert.equal(ui.background, 'rgb(18, 18, 18)', `existing ASC background (${width})`);
    assert.equal(ui.noSignup, true);
    if (width > 720) {
      assert.equal(ui.headerMember, true, `desktop Member link visible (${width})`);
      assert.equal(ui.headerClear, true, `Member and Apply Us are visible without overlap (${width})`);
    } else {
      await evaluate(`document.querySelector('header [class*="header_right"] [class*="mobile_show"]').click()`);
      await sleep(600);
      assert.equal(await evaluate(`(() => {
        const links = [...document.querySelectorAll('header a')].filter((link) => link.textContent === 'Member');
        return links.some((link) => { const box = link.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; });
      })()`), true, 'mobile menu exposes the Member entry');
    }
    checks += 1;
    console.log(`PASS login state and layout: ${width}px (${ui.setupMode ? 'setup' : 'configured'})`);
  }
  for (const route of ['/member/', '/member/password/', '/member/submission/', '/member/schedule/', '/member/resources/', '/member/operations/members/', '/member/operations/submissions/', '/member/operations/teams/', '/member/operations/settings/']) {
    await navigate(base + route);
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      ready = await evaluate(`(() => {
        const text = document.querySelector('main')?.innerText ?? '';
        return text.includes('연결 설정이 필요합니다.') || (location.pathname.includes('/member/login') && !!document.querySelector('form'));
      })()`);
      if (ready) break;
      await sleep(100);
    }
    assert.equal(ready, true, `private route fails closed or redirects to login: ${route}`);
    checks += 1;
    console.log(`PASS no fake private data: ${route}`);
  }
  assert.deepEqual(errors, [], 'no uncaught browser exceptions');
  console.log(`Browser smoke checks: ${checks} passed. Live Supabase Auth/RLS NOT tested.`);
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await Promise.race([once(chrome, 'exit'), sleep(3000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
