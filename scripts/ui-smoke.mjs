import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:5173';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.resolve('docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, 'login.png'), fullPage: true });
  console.log('✓ login page rendered');

  await page.locator('input[placeholder="用户名"]').fill('admin');
  await page.locator('input[placeholder="密码"]').fill('Admin@123456');
  await page.getByRole('button', { name: '进入控制台' }).click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'dashboard.png'), fullPage: true });
  const dashText = await page.locator('body').innerText();
  if (!dashText.includes('运行概览')) throw new Error('dashboard title missing');
  if (!dashText.includes('请求总数')) throw new Error('dashboard KPI missing');
  console.log('✓ admin login + dashboard');

  await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'playground.png'), fullPage: true });
  const playText = await page.locator('body').innerText();
  if (!playText.includes('在线调试')) throw new Error('playground title missing');
  if (!playText.includes('开始一次真实调用') && !playText.includes('选择 API Key')) {
    throw new Error('playground chat empty state missing');
  }
  console.log('✓ Element Plus X playground rendered');

  for (const route of ['providers', 'models', 'keys', 'logs', 'sensitive', 'users', 'audit', 'settings']) {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
    const title = await page.locator('.page-title').first().innerText();
    if (!title) throw new Error(`${route} title missing`);
    console.log(`✓ ${route} (${title})`);
  }

  await page.goto(`${BASE}/sensitive`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, 'sensitive.png'), fullPage: true });

  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[placeholder="用户名"]').fill('viewer');
  await page.locator('input[placeholder="密码"]').fill('Viewer@123456');
  await page.getByRole('button', { name: '进入控制台' }).click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  const viewerText = await page.locator('body').innerText();
  if (!viewerText.includes('只读用户')) throw new Error('viewer role tag missing');
  await page.goto(`${BASE}/providers`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  if (await page.getByRole('button', { name: '添加上游' }).count()) {
    throw new Error('viewer sees add-provider button');
  }
  await page.goto(`${BASE}/keys`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  if (await page.getByRole('button', { name: '签发 Key' }).count()) {
    throw new Error('viewer sees create-key button');
  }
  await page.screenshot({ path: path.join(outDir, 'viewer.png'), fullPage: true });
  console.log('✓ viewer login + read-only UI');

  if (errors.length) {
    console.error('\nBrowser errors:');
    for (const e of errors) console.error(' -', e);
    throw new Error(`${errors.length} browser error(s)`);
  }

  console.log('\n✓ UI SMOKE TEST PASSED');
} finally {
  await browser.close();
}
