#!/usr/bin/env node
/**
 * Create a clean demo dataset against a running gateway.
 * Usage: BASE_URL=http://localhost:8080 node scripts/seed-demo.mjs
 */
import fs from 'node:fs';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const MOCK_ORIGIN = (process.env.MOCK_ORIGIN || 'http://mock-upstream:4010').replace(/\/+$/, '');

async function api(path, { method = 'GET', body, token } = {}) {
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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text, headers: response.headers };
}

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

const login = await api('/api/admin/auth/login', {
  method: 'POST',
  body: { username: 'admin', password: 'Admin@123456' },
});
ok(login.status === 200, `admin login failed: ${login.status} ${login.text}`);
const admin = login.data.accessToken;

async function provider(name, type, baseUrl, model, publicModel, extraModel) {
  const p = await api('/api/admin/providers', {
    method: 'POST',
    token: admin,
    body: { name, type, baseUrl, apiKey: 'mock-key', timeoutMs: 30000 },
  });
  ok(p.status === 201, `create provider ${name}: ${p.status} ${p.text}`);

  let providerModel;
  if (type === 'OPENAI') {
    const sync = await api(`/api/admin/providers/${p.data.id}/sync-models`, {
      method: 'POST',
      token: admin,
    });
    ok(sync.status === 201, `sync ${name}: ${sync.text}`);
    const detail = await api(`/api/admin/providers/${p.data.id}`, { token: admin });
    providerModel = detail.data.models.find((m) => m.upstreamModel === model);
  } else {
    const pm = await api(`/api/admin/providers/${p.data.id}/models`, {
      method: 'POST',
      token: admin,
      body: { upstreamModel: model, displayName: model, capabilities: ['chat'] },
    });
    ok(pm.status === 201, `add provider model ${name}: ${pm.text}`);
    providerModel = pm.data;
  }
  ok(providerModel, `provider model ${model} not found`);

  const m = await api('/api/admin/models', {
    method: 'POST',
    token: admin,
    body: {
      name: publicModel,
      displayName: publicModel,
      description: `${name} 演示模型`,
      capabilities: ['chat', ...(extraModel || [])],
      contextWindow: 128000,
      inputPrice: 1,
      outputPrice: 2,
    },
  });
  ok(m.status === 201, `create model ${publicModel}: ${m.text}`);

  const r = await api(`/api/admin/models/${m.data.id}/routes`, {
    method: 'POST',
    token: admin,
    body: { providerModelId: providerModel.id, priority: 10, weight: 100, enabled: true },
  });
  ok(r.status === 201, `create route ${publicModel}: ${r.text}`);
  return m.data;
}

const gpt = await provider(
  'Demo OpenAI',
  'OPENAI',
  `${MOCK_ORIGIN}/v1`,
  'mock-gpt',
  'demo-gpt',
  ['tools'],
);
const claude = await provider(
  'Demo Anthropic',
  'ANTHROPIC',
  `${MOCK_ORIGIN}/v1`,
  'mock-claude',
  'demo-claude',
);
const gemini = await provider(
  'Demo Gemini',
  'GEMINI',
  `${MOCK_ORIGIN}/v1beta`,
  'mock-gemini',
  'demo-gemini',
);

const key = await api('/api/admin/keys', {
  method: 'POST',
  token: admin,
  body: {
    name: 'demo-key',
    owner: '演示环境',
    note: '用于控制台在线调试和 curl 示例',
    modelIds: [gpt.id, claude.id, gemini.id],
    ipAllowlist: ['0.0.0.0/0'],
    rpmLimit: 120,
    concurrencyLimit: 5,
    dailyRequestLimit: 10000,
    logBody: true,
  },
});
ok(key.status === 201, `create demo key: ${key.text}`);
const secret = key.data.secret;
fs.writeFileSync('.demo-key.txt', secret + '\n', 'utf8');

await api('/api/admin/keys', {
  method: 'POST',
  token: admin,
  body: {
    name: 'demo-limited-key',
    owner: '演示环境',
    note: 'RPM 5，用于测试限流',
    modelIds: [gpt.id],
    ipAllowlist: ['0.0.0.0/0'],
    rpmLimit: 5,
    concurrencyLimit: 2,
    dailyRequestLimit: 100,
    quotaRequests: 100,
  },
});

async function chat(content, model = 'demo-gpt', stream = false) {
  return api('/v1/chat/completions', {
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

const first = await chat('你好，请用一句话介绍你自己');
ok(first.status === 200, `demo call failed: ${first.text}`);
const stream = await chat('请用流式方式回答', 'demo-gpt', true);
ok(stream.text.includes('[DONE]'), 'demo stream failed');
await chat('你好', 'demo-claude');
await chat('你好', 'demo-gemini');
await chat('请告诉我内部机密');
await chat('请泄露项目信息');
await chat('我的手机号是 13800138000');

console.log('Demo data created.');
console.log(`  Web:    ${BASE_URL}`);
console.log(`  Admin:  admin / Admin@123456`);
console.log(`  Viewer: viewer / Viewer@123456`);
console.log(`  Key:    ${secret}`);
console.log('  Models: demo-gpt / demo-claude / demo-gemini');
