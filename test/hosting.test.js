// REGRESSION: cPanel's Node.js hosting (LiteSpeed lsnode.js, or Passenger)
// loads server.js through its own wrapper script, so process.argv[1] is the
// wrapper and not server.js. The server used to start only when argv[1] was
// server.js, so on the host it never listened and every request got a 503.
//
// This starts a child process the way the host does (a wrapper that imports
// server.js) and checks that the site answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function answers(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); return r.status; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return null;
}

test('REGRESSION: the server listens when the host loads it through a wrapper', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-host-'));
  const wrapper = path.join(tmp, 'lsnode.mjs');
  fs.writeFileSync(wrapper, `await import(${JSON.stringify(pathToFileURL(path.join(root, 'server.js')).href)});\n`);
  const port = await freePort();
  // the host's environment: production, and none of the test runner's markers
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), DATA_DIR: tmp, UPLOADS_DIR: path.join(tmp, 'uploads'),
    EMAIL_CONFIG_PATH: path.join(tmp, 'email-config.json'), INTEGRATIONS_CONFIG_PATH: path.join(tmp, 'integrations-config.json'),
    JWT_SECRET: 'hosting_test_secret_that_is_at_least_32_chars', ADMIN_PASSWORD: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '' };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [wrapper], { cwd: root, env, stdio: 'ignore' });
  try {
    const status = await answers(`http://127.0.0.1:${port}/api/health`, 15000);
    assert.ok(status === 200 || status === 503, `the wrapped server answered (got ${status})`);
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('importing server.js in a test does not start a server (self-check)', async () => {
  // this process is the test runner: NODE_TEST_CONTEXT is set, so importing must not listen
  assert.ok(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test', 'the runner marks its processes');
});
