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

test("CloudLinux's activate script, which reads unset variables, does not stop the deploy", { skip: !SH && 'no sh here' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'olira-deploy-'));
  try {
    const repo = checkout(home, 'Olira', 'main');
    const bin = path.join(home, 'nodevenv', 'olira', '22', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    // the real one (line 78) reads CL_VIRTUAL_ENV before it is set
    fs.writeFileSync(path.join(bin, 'activate'), 'if [ -n "$CL_VIRTUAL_ENV" ]; then :; fi\nOLIRA_ACTIVATED=yes\n');
    const r = run(repo, home, { CL_VIRTUAL_ENV: '' });
    const env = { ...process.env }; delete env.CL_VIRTUAL_ENV;
    const clean = spawnSync(SH, [SCRIPT, repo], { encoding: 'utf8', env: { ...env, DEPLOY_HOME: home, DEPLOY_DRY: '1', NODEVER: '22' } });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /node -v\s+v\d+/, 'the dry run loads Node the way the deploy does');
    assert.equal(r.status, 0, r.stderr);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
