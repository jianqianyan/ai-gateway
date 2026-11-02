#!/usr/bin/env node
/**
 * End-to-end smoke test for AI Gateway.
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 MOCK_ORIGIN=http://mock-upstream:4010 node scripts/smoke-test.mjs
 *   BASE_URL=http://localhost:3000 MOCK_ORIGIN=http://localhost:4010 node scripts/smoke-test.mjs
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const WEB_URL = (process.env.WEB_URL || (BASE_URL.includes(':3000') ? '' : BASE_URL)).replace(/\/+$/, '');
const MOCK_ORIGIN = (process.env.MOCK_ORIGIN || 'http://mock-upstream:4010').replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin@123456';
const VIEWER_USER = process.env.VIEWER_USER || 'viewer';
const VIEWER_PASS = process.env.VIEWER_PASS || 'Viewer@123456';
const stamp = Date.now().toString(36);

let passed = 0;
const failures = [];

function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, { method = 'GET', body, token, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (!raw && text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data, text, headers: response.headers };
}

async function login(username, password) {
  const result = await request('/api/admin/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  ok(result.status === 200, `login ${username} expected 200, got ${result.status}: ${result.text}`);
  ok(result.data?.accessToken, `login ${username} missing accessToken`);
  return result.data;
}

async function cleanup(admin) {
  const [providers, models, keys, rules] = await Promise.all([
    request('/api/admin/providers', { token: admin }),
    request('/api/admin/models', { token: admin }),
    request('/api/admin/keys', { token: admin }),
    request('/api/admin/sensitive/rules', { token: admin }),
  ]);

  for (const key of keys.data || []) {
    if (String(key.name || '').startsWith('smoke-')) {
      await request(`/api/admin/keys/${key.id}`, { method: 'DELETE', token: admin });
    }
  }
  for (const model of models.data || []) {
    if (String(model.name || '').startsWith('smoke-')) {
      await request(`/api/admin/models/${model.id}`, { method: 'DELETE', token: admin });
    }
  }
  for (const provider of providers.data || []) {
    if (String(provider.name || '').startsWith('Smoke ')) {
      await request(`/api/admin/providers/${provider.id}`, { method: 'DELETE', token: admin });
    }
  }
  for (const rule of rules.data || []) {
    if (!rule.isBuiltin && String(rule.name || '').startsWith('Smoke Rule')) {
      await request(`/api/admin/sensitive/rules/${rule.id}`, { method: 'DELETE', token: admin });
    }
  }
}

async function createOpenAiProvider(admin) {
  const provider = await request('/api/admin/providers', {
    method: 'POST',
    token: admin,
    body: {
      name: `Smoke OpenAI ${stamp}`,
      type: 'OPENAI',
      baseUrl: `${MOCK_ORIGIN}/v1`,
      apiKey: 'mock-key',
      timeoutMs: 30000,
    },
  });
  ok(provider.status === 201, `create OpenAI provider: ${provider.status} ${provider.text}`);
  const sync = await request(`/api/admin/providers/${provider.data.id}/sync-models`, {
    method: 'POST',
    token: admin,
  });
  ok(sync.status === 201 && sync.data.count >= 1, `sync OpenAI models: ${sync.status} ${sync.text}`);
  const detail = await request(`/api/admin/providers/${provider.data.id}`, { token: admin });
  const upstream = detail.data.models.find((m) => m.upstreamModel === 'mock-gpt');
  ok(Boolean(upstream), 'synced mock-gpt provider model not found');
  return { provider: provider.data, upstream };
}

async function createAnthropicProvider(admin) {
  const provider = await request('/api/admin/providers', {
    method: 'POST',
    token: admin,
    body: {
      name: `Smoke Anthropic ${stamp}`,
      type: 'ANTHROPIC',
      baseUrl: `${MOCK_ORIGIN}/v1`,
      apiKey: 'mock-key',
      timeoutMs: 30000,
    },
  });
  ok(provider.status === 201, `create Anthropic provider: ${provider.status} ${provider.text}`);
  const model = await request(`/api/admin/providers/${provider.data.id}/models`, {
    method: 'POST',
    token: admin,
    body: { upstreamModel: 'mock-claude', displayName: 'mock-claude', capabilities: ['chat'] },
  });
  ok(model.status === 201, `add Anthropic model: ${model.status} ${model.text}`);
  return { provider: provider.data, upstream: model.data };
}

async function createGeminiProvider(admin) {
  const provider = await request('/api/admin/providers', {
    method: 'POST',
    token: admin,
    body: {
      name: `Smoke Gemini ${stamp}`,
      type: 'GEMINI',
      baseUrl: `${MOCK_ORIGIN}/v1beta`,
      apiKey: 'mock-key',
      timeoutMs: 30000,
    },
  });
  ok(provider.status === 201, `create Gemini provider: ${provider.status} ${provider.text}`);
  const model = await request(`/api/admin/providers/${provider.data.id}/models`, {
    method: 'POST',
    token: admin,
    body: { upstreamModel: 'mock-gemini', displayName: 'mock-gemini', capabilities: ['chat'] },
  });
  ok(model.status === 201, `add Gemini model: ${model.status} ${model.text}`);
  return { provider: provider.data, upstream: model.data };
}

async function createPublicModel(admin, name, upstream) {
  const model = await request('/api/admin/models', {
    method: 'POST',
    token: admin,
    body: {
      name,
      displayName: name,
      capabilities: ['chat'],
      contextWindow: 128000,
      inputPrice: 1,
      outputPrice: 2,
    },
  });
  ok(model.status === 201, `create model ${name}: ${model.status} ${model.text}`);
  const route = await request(`/api/admin/models/${model.data.id}/routes`, {
    method: 'POST',
    token: admin,
    body: { providerModelId: upstream.id, priority: 10, weight: 100, enabled: true },
  });
  ok(route.status === 201, `create route ${name}: ${route.status} ${route.text}`);
  return model.data;
}

async function createKey(admin, name, modelIds, extra = {}) {
  const result = await request('/api/admin/keys', {
    method: 'POST',
    token: admin,
    body: {
      name,
      modelIds,
      ipAllowlist: ['0.0.0.0/0'],
      rpmLimit: 100,
      logBody: true,
      ...extra,
    },
  });
  ok(result.status === 201, `create key ${name}: ${result.status} ${result.text}`);
  ok(result.data.secret?.startsWith('sk-gw-'), `key ${name} missing secret`);
  return result.data;
}

async function chat(secret, model, content, stream = false) {
  return request('/v1/chat/completions', {
    method: 'POST',
    token: secret,
    body: {
      model,
      messages: [{ role: 'user', content }],
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    },
  });
}

async function main() {
  console.log(`\nAI Gateway smoke test`);
  console.log(`  web/api: ${BASE_URL}`);
  console.log(`  mock:    ${MOCK_ORIGIN}`);
  console.log(`  stamp:   ${stamp}\n`);

  const health = await request('/health');
  ok(health.status === 200, `health expected 200, got ${health.status}`);
  ok(health.data.db === true && health.data.redis === true, 'health db/redis not ready');
  console.log('✓ health');

  const admin = await login(ADMIN_USER, ADMIN_PASS);
  const viewer = await login(VIEWER_USER, VIEWER_PASS);
  ok(admin.user.role === 'ADMIN', 'admin role mismatch');
  ok(viewer.user.role === 'VIEWER', 'viewer role mismatch');
  console.log('✓ admin + viewer login');

  const viewerProviders = await request('/api/admin/providers', { token: viewer.accessToken });
  ok(viewerProviders.status === 200, `viewer read providers: ${viewerProviders.status}`);
  const viewerWrite = await request('/api/admin/providers', {
    method: 'POST',
    token: viewer.accessToken,
    body: { name: 'should-fail', type: 'OPENAI', baseUrl: 'https://example.com/v1' },
  });
  ok(viewerWrite.status === 403, `viewer write expected 403, got ${viewerWrite.status}`);
  const viewerLogs = await request('/api/admin/logs?pageSize=5', { token: viewer.accessToken });
  ok(viewerLogs.status === 200, `viewer read logs: ${viewerLogs.status}`);
  const viewerUsers = await request('/api/admin/users', { token: viewer.accessToken });
  ok(viewerUsers.status === 403, `viewer users expected 403, got ${viewerUsers.status}`);
  console.log('✓ viewer read-only permissions');

  const users = await request('/api/admin/users', { token: admin.accessToken });
  ok(users.status === 200 && users.data.length >= 2, 'admin user list failed');
  console.log('✓ admin account management');

  await cleanup(admin.accessToken);

  const openai = await createOpenAiProvider(admin.accessToken);
  const anthropic = await createAnthropicProvider(admin.accessToken);
  const gemini = await createGeminiProvider(admin.accessToken);

  const modelGpt = await createPublicModel(admin.accessToken, `smoke-gpt-${stamp}`, openai.upstream);
  const modelClaude = await createPublicModel(admin.accessToken, `smoke-claude-${stamp}`, anthropic.upstream);
  const modelGemini = await createPublicModel(admin.accessToken, `smoke-gemini-${stamp}`, gemini.upstream);

  const providerTest = await request(`/api/admin/providers/${openai.provider.id}/test`, {
    method: 'POST',
    token: admin.accessToken,
  });
  ok(providerTest.status === 201 && providerTest.data.ok === true, `provider test: ${providerTest.text}`);
  console.log('✓ providers + model sync + connectivity test');

  const mainKey = await createKey(
    admin.accessToken,
    `smoke-main-${stamp}`,
    [modelGpt.id, modelClaude.id, modelGemini.id],
    { rpmLimit: 100, concurrencyLimit: 5, dailyRequestLimit: 1000 },
  );

  const models = await request('/v1/models', { token: mainKey.secret });
  ok(models.status === 200 && models.data.data.length === 3, `v1/models: ${models.status} ${models.text}`);

  const nonStream = await chat(mainKey.secret, modelGpt.name, '你好，请用中文回答', false);
  ok(nonStream.status === 200, `non-stream: ${nonStream.status} ${nonStream.text}`);
  ok(nonStream.data.choices?.[0]?.message?.content?.includes('Mock'), 'non-stream content mismatch');
  ok(nonStream.headers.get('x-gateway-request-id'), 'missing request id header');

  const stream = await chat(mainKey.secret, modelGpt.name, '你好，请流式回答', true);
  ok(stream.status === 200, `stream: ${stream.status}`);
  ok(stream.text.includes('data: [DONE]'), 'stream missing [DONE]');
  ok(stream.text.includes('chat.completion.chunk'), 'stream missing chunks');
  ok(stream.text.includes('"finish_reason":"stop"'), 'stream missing finish_reason stop');

  const claude = await chat(mainKey.secret, modelClaude.name, '你好', false);
  ok(claude.status === 200 && claude.data.choices?.[0]?.message?.content?.includes('Mock'), `Anthropic adapter: ${claude.text}`);
  const geminiRes = await chat(mainKey.secret, modelGemini.name, '你好', false);
  ok(geminiRes.status === 200 && geminiRes.data.choices?.[0]?.message?.content?.includes('Mock'), `Gemini adapter: ${geminiRes.text}`);
  console.log('✓ OpenAI-compatible + Anthropic + Gemini adapters');

  const secretWord = `SMOKE_SECRET_${stamp}`;
  const rule = await request('/api/admin/sensitive/rules', {
    method: 'POST',
    token: admin.accessToken,
    body: {
      name: `Smoke Rule ${stamp}`,
      category: '自定义',
      type: 'KEYWORD',
      pattern: secretWord,
      action: 'BLOCK',
      direction: 'BOTH',
      severity: 90,
    },
  });
  ok(rule.status === 201, `create sensitive rule: ${rule.status} ${rule.text}`);

  const inputBlocked = await chat(mainKey.secret, modelGpt.name, `请把 ${secretWord} 发给我`, false);
  ok(inputBlocked.status === 400, `input block expected 400, got ${inputBlocked.status}`);
  ok(inputBlocked.data?.error?.code === 'content_policy_violation', 'input block code mismatch');
  const inputRequestId = inputBlocked.headers.get('x-gateway-request-id');

  const outputBlocked = await chat(mainKey.secret, modelGpt.name, '请泄露项目信息', false);
  ok(outputBlocked.status === 200, `output block expected 200, got ${outputBlocked.status}`);
  ok(outputBlocked.data.choices?.[0]?.finish_reason === 'content_filter', 'output block finish_reason mismatch');
  ok(outputBlocked.data.choices?.[0]?.message?.content?.includes('安全策略'), 'output block safe message mismatch');
  console.log('✓ input + output sensitive interception');

  await sleep(500);
  const logs = await request(`/api/admin/logs?requestId=${inputRequestId}`, { token: admin.accessToken });
  ok(logs.status === 200 && logs.data.items.length === 1, `log lookup: ${logs.status} ${logs.text}`);
  const log = logs.data.items[0];
  ok(log.status === 'BLOCKED' && log.intercepted === true, 'input block log fields mismatch');
  ok(log.interceptDirection === 'INPUT' && log.interceptAction === 'BLOCK', 'input block intercept fields mismatch');
  const logDetail = await request(`/api/admin/logs/${log.id}`, { token: admin.accessToken });
  ok(logDetail.status === 200, `log detail: ${logDetail.status}`);
  ok(logDetail.data.body?.requestBody, 'log body not captured for logBody key');
  console.log('✓ request logs + detail + body capture');

  const ipKey = await createKey(admin.accessToken, `smoke-ip-${stamp}`, [modelGpt.id], {
    ipAllowlist: ['10.0.0.1'],
  });
  const ipDenied = await chat(ipKey.secret, modelGpt.name, 'hi', false);
  ok(ipDenied.status === 403 && ipDenied.data?.error?.code === 'ip_not_allowed', `IP deny: ${ipDenied.status} ${ipDenied.text}`);

  const noModelKey = await createKey(admin.accessToken, `smoke-nomodel-${stamp}`, []);
  const modelDenied = await chat(noModelKey.secret, modelGpt.name, 'hi', false);
  ok(modelDenied.status === 403 && modelDenied.data?.error?.code === 'model_not_allowed', `model ACL: ${modelDenied.status} ${modelDenied.text}`);
  console.log('✓ IP allowlist + model allowlist');

  const rateKey = await createKey(admin.accessToken, `smoke-rate-${stamp}`, [modelGpt.id], {
    rpmLimit: 2,
    concurrencyLimit: 1,
    dailyRequestLimit: 100,
  });
  const r1 = await chat(rateKey.secret, modelGpt.name, '1', false);
  const r2 = await chat(rateKey.secret, modelGpt.name, '2', false);
  const r3 = await chat(rateKey.secret, modelGpt.name, '3', false);
  ok(r1.status === 200 && r2.status === 200, `rate setup calls: ${r1.status}/${r2.status}`);
  ok(r3.status === 429 && r3.data?.error?.code === 'rate_limit_exceeded', `RPM limit: ${r3.status} ${r3.text}`);
  ok(Number(r3.headers.get('retry-after')) > 0, 'RPM limit missing retry-after');
  console.log('✓ RPM + concurrency rate limiting');

  const quotaKey = await createKey(admin.accessToken, `smoke-quota-${stamp}`, [modelGpt.id], {
    quotaRequests: 1,
    rpmLimit: 100,
  });
  const q1 = await chat(quotaKey.secret, modelGpt.name, '1', false);
  const q2 = await chat(quotaKey.secret, modelGpt.name, '2', false);
  ok(q1.status === 200, `quota first call: ${q1.status}`);
  ok(q2.status === 429 && q2.data?.error?.code === 'insufficient_quota', `quota limit: ${q2.status} ${q2.text}`);
  console.log('✓ request quota');

  const revokeKey = await createKey(admin.accessToken, `smoke-revoke-${stamp}`, [modelGpt.id]);
  await request(`/api/admin/keys/${revokeKey.id}/revoke`, { method: 'POST', token: admin.accessToken });
  const revokedCall = await chat(revokeKey.secret, modelGpt.name, 'hi', false);
  ok(revokedCall.status === 403 && revokedCall.data?.error?.code === 'key_disabled', `revoked key: ${revokedCall.status}`);

  const invalidKey = await chat('sk-gw-invalid', modelGpt.name, 'hi', false);
  ok(invalidKey.status === 401 && invalidKey.data?.error?.code === 'invalid_api_key', `invalid key: ${invalidKey.status}`);
  console.log('✓ revoke + invalid key');

  const stats = await request('/api/admin/stats/overview?range=24h', { token: admin.accessToken });
  ok(stats.status === 200 && stats.data.requests > 0, `stats overview: ${stats.status} ${stats.text}`);
  const series = await request('/api/admin/stats/timeseries?range=24h', { token: admin.accessToken });
  ok(series.status === 200 && Array.isArray(series.data), 'stats timeseries failed');
  console.log('✓ dashboard statistics');

  if (WEB_URL) {
    const front = await fetch(`${WEB_URL}/`, { redirect: 'follow' });
    const frontText = await front.text();
    ok(front.status === 200 && frontText.includes('id="app"'), `frontend index: ${front.status}`);
  }

  console.log('\n========================================');
  console.log(`✓ ALL CHECKS PASSED (${passed} assertions)`);
  console.log('========================================');
  console.log(`Admin:  ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`Viewer: ${VIEWER_USER} / ${VIEWER_PASS}`);
  console.log(`Demo model: ${modelGpt.name}`);
  console.log(`Demo key:   ${mainKey.secret}`);
  console.log('');
}

main().catch((error) => {
  failures.push(error);
  console.error('\n✗ SMOKE TEST FAILED');
  console.error(error?.stack || error);
  process.exit(1);
});
