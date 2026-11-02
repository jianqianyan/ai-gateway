#!/usr/bin/env node
/**
 * One-command regression gate.
 *
 *   pnpm test:regression
 *
 * Runs:
 *   1. Docker image prefix policy check
 *   2. Backend unit tests
 *   3. API feature regression
 *   4. Browser page regression (admin + viewer + playground chat)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const UI_BASE = (process.env.UI_BASE || BASE_URL).replace(/\/+$/, '');
const ROOT = process.cwd();

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function run(label, command, args, env = {}) {
  console.log(`\n── ${label} ─────────────────────────────────────`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
  console.log(`✓ ${label}`);
}

function checkImagePrefixes() {
  console.log('\n── Docker image prefix policy ──────────────────');
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  const imageLines = compose
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('image:'));
  if (!imageLines.length) fail('No images found in docker-compose.yml');
  for (const line of imageLines) {
    const image = line.slice('image:'.length).trim();
    if (!image.startsWith('docker.m.daocloud.io/')) {
      fail(`docker-compose image must use docker.m.daocloud.io/: ${image}`);
    }
    console.log(`  ✓ ${image}`);
  }

  const dockerfiles = [
    'docker/api.Dockerfile',
    'docker/web.Dockerfile',
    'docker/mock-upstream/Dockerfile',
  ];
  for (const relative of dockerfiles) {
    const content = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const fromLines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('FROM '));
    if (!fromLines.length) fail(`${relative}: no FROM line`);
    for (const line of fromLines) {
      const image = line.slice(5).trim().split(/\s+/)[0];
      if (!image.startsWith('docker.m.daocloud.io/')) {
        fail(`${relative} FROM must use docker.m.daocloud.io/: ${image}`);
      }
      console.log(`  ✓ ${relative} -> ${image}`);
    }
  }
}

async function checkHealth() {
  console.log('\n── Service health ──────────────────────────────');
  let response;
  try {
    response = await fetch(`${BASE_URL}/health`);
  } catch (error) {
    fail(`Cannot reach ${BASE_URL}/health. Start Docker with: docker compose --profile test up -d --build`);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.db || !data?.redis) {
    fail(`Health check failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  console.log(`  ✓ ${BASE_URL} (db + redis healthy)`);
}

console.log('AI Gateway regression gate');
console.log(`  BASE_URL=${BASE_URL}`);
console.log(`  UI_BASE=${UI_BASE}`);

checkImagePrefixes();
await checkHealth();

run('Backend unit tests', 'pnpm', ['--filter', '@ai-gateway/api', 'test']);
run('API feature regression', 'node', ['scripts/regression-api.mjs'], {
  BASE_URL,
});
run('Page/browser regression', 'node', ['scripts/regression-ui.mjs'], {
  UI_BASE,
});

console.log('\n================================================');
console.log('✓ FULL REGRESSION PASSED');
console.log('  unit + API feature + browser page tests');
console.log('================================================\n');
