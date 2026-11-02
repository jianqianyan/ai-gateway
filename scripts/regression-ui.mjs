#!/usr/bin/env node
/**
 * Page-level regression with real browser interactions.
 * Requires the Docker stack (web on 8080) and a local Chrome.
 *
 * Run:
 *   UI_BASE=http://localhost:8080 node scripts/regression-ui.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.UI_BASE || 'http://localhost:8080').replace(/\/+$/, '');
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin@123456';
const VIEWER_USER = process.env.VIEWER_USER || 'viewer';
const VIEWER_PASS = process.env.VIEWER_PASS || 'Viewer@123456';
const stamp = Date.now().toString(36);
const prefix = `ui-${stamp}`;
const outDir = path.resolve('docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });

let passed = 0;
const errors = [];

function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

async function api(pathname, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

async function cleanup(token) {
  const [keys, models, providers, users, rules] = await Promise.all([
    api('/api/admin/keys', { token }),
    api('/api/admin/models', { token }),
    api('/api/admin/providers', { token }),
    api('/api/admin/users', { token }),
    api('/api/admin/sensitive/rules', { token }),
  ]);
  for (const key of keys.data || []) {
    if (String(key.name || '').startsWith('ui-')) {
      await api(`/api/admin/keys/${key.id}`, { method: 'DELETE', token });
    }
  }
  for (const model of models.data || []) {
    if (String(model.name || '').startsWith('ui-')) {
      await api(`/api/admin/models/${model.id}`, { method: 'DELETE', token });
    }
  }
  for (const provider of providers.data || []) {
    if (String(provider.name || '').startsWith('ui-')) {
      await api(`/api/admin/providers/${provider.id}`, { method: 'DELETE', token });
    }
  }
  for (const user of users.data || []) {
    if (String(user.username || '').startsWith('ui-')) {
      await api(`/api/admin/users/${user.id}`, { method: 'DELETE', token });
    }
  }
  for (const rule of rules.data || []) {
    if (!rule.isBuiltin && String(rule.name || '').startsWith('ui-')) {
      await api(`/api/admin/sensitive/rules/${rule.id}`, { method: 'DELETE', token });
    }
  }
}

async function login(page, username, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[placeholder="用户名"]').fill(username);
  await page.locator('input[placeholder="密码"]').fill(password);
  await page.getByRole('button', { name: '进入控制台' }).click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

async function confirmMessageBox(page) {
  const box = page.locator('.el-message-box');
  await box.waitFor({ state: 'visible' });
  await box.getByRole('button', { name: '确定' }).click();
  await box.waitFor({ state: 'hidden' }).catch(() => undefined);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

let adminToken = '';
try {
  const loginRes = await api('/api/admin/auth/login', {
    method: 'POST',
    body: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  ok(loginRes.status === 200, `admin API login: ${loginRes.status}`);
  adminToken = loginRes.data.accessToken;
  await cleanup(adminToken);

  await login(page, ADMIN_USER, ADMIN_PASS);
  ok((await page.locator('.page-title').first().innerText()).includes('运行概览'), 'dashboard not loaded');
  await page.getByText('7 天', { exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByText('24 小时', { exact: true }).click();
  ok((await page.locator('canvas').count()) > 0, 'dashboard charts missing');
  console.log('✓ dashboard + range switch');

  // Provider page: create through the form, then delete.
  await page.goto(`${BASE}/providers`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '添加上游' }).click();
  const providerDialog = page.locator('.el-dialog').first();
  await providerDialog.waitFor({ state: 'visible' });
  await providerDialog.locator('input[placeholder="例如：OpenAI 主账号"]').fill(`${prefix}-provider`);
  await providerDialog.locator('input[placeholder="https://api.openai.com/v1"]').fill('http://mock-upstream:4010/v1');
  await providerDialog.locator('input[placeholder="输入上游 API Key"]').fill('ui-test-key');
  await providerDialog.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(900);
  ok(await page.getByText(`${prefix}-provider`).count(), 'provider create via UI failed');
  const providerRow = page.locator('tr', { hasText: `${prefix}-provider` }).first();
  await providerRow.getByRole('button', { name: '删除' }).click();
  await confirmMessageBox(page);
  await page.waitForTimeout(600);
  ok((await page.getByText(`${prefix}-provider`).count()) === 0, 'provider delete via UI failed');
  console.log('✓ providers page create/delete');

  // Model page: create through the form, then delete.
  await page.goto(`${BASE}/models`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '创建模型' }).click();
  const modelDialog = page.locator('.el-dialog').first();
  await modelDialog.waitFor({ state: 'visible' });
  await modelDialog.locator('input[placeholder*="客户端请求时使用的 model"]').fill(`${prefix}-model`);
  await modelDialog.locator('input[placeholder="如 GPT-4o mini"]').fill(`${prefix} Model`);
  await modelDialog.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(900);
  ok(await page.getByText(`${prefix}-model`).count(), 'model create via UI failed');
  const modelRow = page.locator('tr', { hasText: `${prefix}-model` }).first();
  await modelRow.getByRole('button', { name: '删除' }).click();
  await confirmMessageBox(page);
  await page.waitForTimeout(600);
  ok((await page.getByText(`${prefix}-model`).count()) === 0, 'model delete via UI failed');
  console.log('✓ models page create/delete');

  // Key wizard: create a key with the demo model, show secret, then clean up via API.
  await page.goto(`${BASE}/keys`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '签发 Key' }).click();
  const keyDialog = page.locator('.el-dialog').first();
  await keyDialog.waitFor({ state: 'visible' });
  await keyDialog.locator('input[placeholder="例如：内容平台-生产"]').fill(`${prefix}-key`);
  await keyDialog.getByRole('button', { name: '下一步' }).click();
  await page.waitForTimeout(300);
  await keyDialog.locator('.el-select').first().click();
  await page.locator('.el-select-dropdown__item').first().click();
  await keyDialog.getByRole('button', { name: '下一步' }).click();
  await page.waitForTimeout(300);
  await keyDialog.getByRole('button', { name: '确认签发' }).click();
  await page.waitForTimeout(900);
  const secretDialog = page.locator('.el-dialog').filter({ hasText: '请保存你的 Key' }).first();
  await secretDialog.waitFor({ state: 'visible' });
  const secret = (await secretDialog.locator('.secret-value').innerText()).trim();
  ok(secret.startsWith('sk-gw-'), 'key wizard did not show secret');
  await secretDialog.getByRole('button', { name: '我已保存' }).click();
  await page.waitForTimeout(500);
  ok(await page.getByText(`${prefix}-key`).count(), 'key wizard created key not listed');
  console.log('✓ keys page wizard');

  // Sensitive tester.
  await page.goto(`${BASE}/sensitive`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: '规则测试器' }).click();
  const tester = page.locator('textarea').first();
  await tester.fill('手机号 13800138000，内部机密');
  await page.getByRole('button', { name: '开始检测' }).click();
  await page.waitForTimeout(600);
  const resultText = await page.locator('.result-summary').innerText();
  ok(resultText.includes('阻断') || resultText.includes('脱敏'), 'sensitive tester action missing');
  ok((await page.locator('.match-table tbody tr').count()) >= 2, 'sensitive tester matches missing');
  console.log('✓ sensitive rules tester');

  // Logs page: detail + CSV download.
  await page.goto(`${BASE}/logs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '详情' }).first().click();
  const drawer = page.locator('.el-drawer').filter({ hasText: '调用详情' }).first();
  await drawer.waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  await drawer.getByText('路由尝试').waitFor({ state: 'visible', timeout: 5000 });
  ok(await drawer.getByText('路由尝试').count(), 'log detail drawer missing attempts');
  await drawer.locator('.el-drawer__close-btn').click();
  await page.keyboard.press('Escape');
  await page.mouse.move(800, 500);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '导出 CSV' }).click();
  await page.getByText('CSV 已开始下载').waitFor({ state: 'visible', timeout: 10000 });
  ok(true, 'CSV export did not confirm');
  console.log('✓ logs page detail + export');

  // Users page: render and admin action available.
  await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
  ok(await page.getByRole('button', { name: '新建账号' }).count(), 'users page missing create button');
  ok(await page.getByText(ADMIN_USER, { exact: true }).count(), 'users page missing admin row');
  console.log('✓ users page');

  // Settings + audit render.
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  ok(await page.getByText('接入信息').count(), 'settings page missing endpoint info');
  await page.goto(`${BASE}/audit`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  ok((await page.locator('.el-table__body tbody tr').count()) > 0, 'audit table empty');
  console.log('✓ settings + audit pages');

  // Playground: real streamed chat.
  await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const prompt = page.locator('.empty-prompt');
  if (await prompt.count()) await prompt.click();
  await page.waitForTimeout(300);
  await page.locator('[contenteditable="true"]').first().click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  const assistantText = await page.locator('.markdown-body').first().innerText().catch(() => '');
  ok(assistantText.includes('Mock'), 'playground chat did not return Mock response');
  ok((await page.locator('.elx-bubble__content--loading').count()) === 0, 'playground stuck loading');
  await page.screenshot({ path: path.join(outDir, 'playground-chat.png'), fullPage: true });
  console.log('✓ playground page streamed chat');

  // Viewer read-only page enforcement.
  await login(page, VIEWER_USER, VIEWER_PASS);
  ok((await page.locator('body').innerText()).includes('只读用户'), 'viewer role tag missing');
  await page.goto(`${BASE}/providers`, { waitUntil: 'networkidle' });
  ok((await page.getByRole('button', { name: '添加上游' }).count()) === 0, 'viewer sees provider create');
  await page.goto(`${BASE}/keys`, { waitUntil: 'networkidle' });
  ok((await page.getByRole('button', { name: '签发 Key' }).count()) === 0, 'viewer sees key create');
  await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  ok(page.url().includes('/dashboard'), 'viewer can open users page');
  console.log('✓ viewer read-only pages');

  if (errors.length) {
    throw new Error(`browser errors: ${errors.join(' | ')}`);
  }

  console.log(`\n========================================`);
  console.log(`UI regression: ${passed} assertions passed`);
  console.log(`========================================\n`);
} catch (error) {
  try {
    await page.screenshot({ path: path.join(outDir, 'ui-regression-failure.png'), fullPage: true });
  } catch {
    // ignore
  }
  console.error('\n✗ UI REGRESSION FAILED');
  console.error(error?.stack || error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally {
  if (adminToken) await cleanup(adminToken);
  await browser.close();
}
