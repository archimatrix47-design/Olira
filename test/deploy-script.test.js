// scripts/deploy.sh: the checkout's branch decides which app it deploys to, so
// the staging checkout can never land on the live site. Dry runs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/deploy.sh');
const SH = process.platform === 'win32' ? ['C:/Program Files/Git/bin/sh.exe', 'C:/Program Files/Git/usr/bin/sh.exe'].find((p) => fs.existsSync(p)) : '/bin/sh';
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function checkout(home, name, branch) {
  const repo = path.join(home, 'repositories', name);
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'server.js'), '');
  fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  git(repo, 'init', '-q', '-b', branch);
  git(repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  return repo;
}
const run = (repo, home, extra = {}) => spawnSync(SH, [SCRIPT, repo], { encoding: 'utf8', env: { ...process.env, DEPLOY_HOME: home, DEPLOY_DRY: '1', NODEVER: '22', ...extra } });

test('deploy.sh sends each branch to its own app', { skip: !SH && 'no sh here' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-deploy-'));
  try {
    const live = run(checkout(home, 'Olira', 'main'), home);
    assert.equal(live.status, 0, live.stderr);
    assert.match(live.stdout, /app\s+\S+[\\/]olira\n/);
    assert.match(live.stdout, /data\s+\S+olira-data\n/);
    assert.match(live.stdout, /nodevenv.olira.22.bin.activate/);
    assert.match(live.stdout, /mode\s+production, then IndexNow/);

    const staging = run(checkout(home, 'Olira-staging', 'staging'), home);
    assert.equal(staging.status, 0, staging.stderr);
    assert.match(staging.stdout, /app\s+\S+olira-staging\n/);
    assert.match(staging.stdout, /data\s+\S+olira-staging-data\n/);
    assert.match(staging.stdout, /mode\s+staging\n/);
    assert.doesNotMatch(staging.stdout, /app\s+\S+[\\/]olira\n/, 'never the live app');

    const feature = run(checkout(home, 'Olira-feature', 'user-test-fixes'), home);
    assert.notEqual(feature.status, 0);
    assert.match(feature.stderr, /neither main nor staging; nothing deployed/);

    const elsewhere = run(home, home);
    assert.notEqual(elsewhere.status, 0, 'not run from a checkout: stops');
    assert.match(elsewhere.stderr, /not the Olira checkout/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
