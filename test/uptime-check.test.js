// scripts/uptime-check.sh: quiet while healthy, one line when the site goes
// down, one when it is back (cron mails whatever it prints).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/uptime-check.sh');
const SH = process.platform === 'win32' ? ['C:/Program Files/Git/bin/sh.exe', 'C:/Program Files/Git/usr/bin/sh.exe'].find((p) => fs.existsSync(p)) : '/bin/sh';

test('one mail when the site goes down, one when it comes back', { skip: !SH && 'no sh here' }, async () => {
  let answer = { status: 'ok' };
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(answer)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-uptime-'));
  const state = path.join(dir, 'down');
  const url = `http://127.0.0.1:${server.address().port}/api/health`;
  const check = (u = url) => new Promise((resolve) => {
    // async spawn: the test's own server must keep answering while the script runs
    import('node:child_process').then(({ spawn }) => {
      const p = spawn(SH, [SCRIPT, u], { env: { ...process.env, UPTIME_STATE: state } });
      let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
      p.on('close', (status) => resolve({ status, out: out.trim() }));
    });
  });
  try {
    assert.deepEqual(await check(), { status: 0, out: '' }, 'healthy: nothing to mail');
    answer = { status: 'degraded', failing: ['dataDirWritable'] };
    const down = await check();
    assert.match(down.out, /Olira is DOWN: .*degraded/);
    assert.ok(fs.existsSync(state));
    assert.equal((await check()).out, '', 'still down: no second mail');
    answer = { status: 'ok' };
    assert.match((await check()).out, /Olira is back up .* It was down from \d{4}-\d\d-\d\d/);
    assert.ok(!fs.existsSync(state));
    assert.equal((await check()).out, '');
    const dead = await check('http://127.0.0.1:1/api/health');
    assert.match(dead.out, /Olira is DOWN: .*curl exit [1-9]/, 'no answer at all is down too');
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
