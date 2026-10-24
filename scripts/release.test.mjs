import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let sandbox;
let work;
let origin;
const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: 'pipe' }).trim();
const release = version => spawnSync(process.execPath, ['scripts/release.mjs', version], {
  cwd: work, encoding: 'utf8', env: { ...process.env, npm_config_ignore_scripts: 'true' },
});

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-release-test-'));
  work = path.join(sandbox, 'work');
  origin = path.join(sandbox, 'origin.git');
  fs.mkdirSync(work);
  fs.mkdirSync(path.join(work, 'scripts'));
  fs.mkdirSync(path.join(work, 'src-tauri'));
  for (const name of ['release.mjs', 'releaseVersion.mjs', 'sync-version.mjs']) {
    fs.copyFileSync(new URL(name, import.meta.url), path.join(work, 'scripts', name));
  }
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'lumina', version: '0.2.56', private: true }));
  fs.writeFileSync(path.join(work, 'package-lock.json'), JSON.stringify({ name: 'lumina', version: '0.2.56', lockfileVersion: 3, packages: { '': { name: 'lumina', version: '0.2.56' } } }));
  fs.writeFileSync(path.join(work, 'src-tauri/Cargo.toml'), '[package]\nname = "lumina"\nversion = "0.2.56"\n');
  fs.writeFileSync(path.join(work, 'src-tauri/Cargo.lock'), '[[package]]\nname = "lumina"\nversion = "0.2.56"\n');
  fs.writeFileSync(path.join(work, 'src-tauri/tauri.conf.json'), '{"version":"0.2.56"}\n');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('add', '.');
  git('commit', '-m', 'initial');
  git('init', '--bare', origin);
  git('remote', 'add', 'origin', origin);
  git('tag', 'v0.2.55');
  git('tag', 'v0.2.56');
  git('push', 'origin', 'main', 'v0.2.55', 'v0.2.56');
  git('tag', '-d', 'v0.2.55');
  git('tag', '-d', 'v0.2.56');
});
afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

describe('release preflight and atomic publication', () => {
  it.each(['0.2.55', '0.2.56', '0.2.40'])('rejects unavailable version %s before changing files or refs', version => {
    const before = git('rev-parse', 'HEAD');
    const refs = git('ls-remote', 'origin');
    const result = release(version);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already exists|must be newer/);
    expect(git('status', '--porcelain')).toBe('');
    expect(git('rev-parse', 'HEAD')).toBe(before);
    expect(git('ls-remote', 'origin')).toBe(refs);
    expect(git('tag', '-l')).toBe('');
  });

  it('bumps from the remote baseline and pushes a matching annotated tag and branch', () => {
    const result = release('patch');
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(work, 'package.json'))).version).toBe('0.2.57');
    const head = git('rev-parse', 'HEAD');
    expect(git('ls-remote', 'origin', 'refs/heads/main')).toContain(head);
    expect(git('ls-remote', 'origin', 'refs/tags/v0.2.57^{}')).toContain(head);
    expect(git('cat-file', '-t', 'v0.2.57')).toBe('tag');
  });

  it('does not push the release branch when the server rejects the tag', () => {
    const before = git('rev-parse', 'HEAD');
    // A tag can become unavailable after preflight; reject it at receive time.
    const hook = path.join(origin, 'hooks/update');
    fs.writeFileSync(hook, '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1;; esac\n');
    fs.chmodSync(hook, 0o755);
    const result = release('patch');
    expect(result.status).not.toBe(0);
    expect(git('ls-remote', 'origin', 'refs/heads/main')).toContain(before);
    expect(git('ls-remote', 'origin', 'refs/tags/v0.2.57')).toBe('');
  });
});
