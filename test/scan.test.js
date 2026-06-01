import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { analyzeRepository, parseArgs } from '../src/index.js';

const tmpRoot = path.join(process.cwd(), 'test', '.tmp-repos');

test('scores a publishable Node repository highly', (t) => {
  const repo = makeRepo(t, 'healthy');
  write(repo, 'README.md', '# Demo\n\nUsage docs.');
  write(repo, 'LICENSE', 'MIT');
  write(repo, '.gitignore', 'node_modules\n.env\n');
  write(repo, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }, null, 2));
  write(repo, 'package-lock.json', '{}');
  write(repo, '.github/workflows/ci.yml', 'name: ci\n');
  write(repo, 'test/example.test.js', 'import test from "node:test";\n');
  write(repo, '.env.example', 'API_KEY=replace-me\n');
  write(repo, 'CONTRIBUTING.md', '# Contributing\n');

  const report = analyzeRepository(repo);

  assert.equal(report.grade, 'A');
  assert.equal(report.findings.secretFindings.length, 0);
});

test('flags private env files and obvious secret patterns without secret values', (t) => {
  const repo = makeRepo(t, 'risky');
  write(repo, 'README.md', '# Risky\n');
  write(repo, 'package.json', JSON.stringify({ scripts: {} }, null, 2));
  write(repo, '.env', 'API_KEY=do-not-read-this-file\n');
  const fakeKey = ['sk', '123456789012345678901234'].join('-');
  write(repo, 'src/config.js', `const token = "${fakeKey}";\n`);

  const report = analyzeRepository(repo);
  const envCheck = report.checks.find((check) => check.id === 'env-hygiene');
  const secretCheck = report.checks.find((check) => check.id === 'secret-scan');
  const serialized = JSON.stringify(report);

  assert.equal(envCheck.passed, false);
  assert.equal(secretCheck.passed, false);
  assert.match(serialized, /src\/config\.js:1/);
  assert.doesNotMatch(serialized, /do-not-read-this-file/);
});

test('parses CLI options', () => {
  assert.deepEqual(parseArgs(['repo', '--json', '--fail-under', '80']), {
    target: 'repo',
    json: true,
    failUnder: 80,
    help: false,
    version: false
  });
});

function makeRepo(t, name) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  const repo = path.join(tmpRoot, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(repo, { recursive: true });
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });
  return repo;
}

function write(repo, relativePath, content) {
  const fullPath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}
