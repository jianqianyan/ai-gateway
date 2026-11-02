#!/usr/bin/env node
/**
 * Feature-level API regression.
 *
 * Covers: auth/refresh/logout/password, users, providers, models/routes,
 * keys lifecycle, gateway protocols, sensitive rules/policies, IP/rate/quota,
 * logs, stats, settings, audit, playground, viewer permissions.
 *
 * Run against Docker:
 *   BASE_URL=http://localhost:8080 MOCK_ORIGIN=http://mock-upstream:4010 node scripts/regression-api.mjs
 */
const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const MOCK_ORIGIN = (process.env.MOCK_ORIGIN || 'http://mock-upstream:4010').replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin@123456';
const VIEWER_USER = process.env.VIEWER_USER || 'viewer';
const VIEWER_PASS = process.env.VIEWER_PASS || 'Viewer@123456';
const stamp = Date.now().toString(36);
const prefix = `reg-${stamp}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, { method = 'GET', body, token, cookie, raw = false, headers = {} } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['content-type'] = 'application/json';
  if (token) finalHeaders.authorization = `Bearer ${token}`;
  if (cookie) finalHeaders.cookie = cookie;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
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

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function login(username, password) {
  const response = await request('/api/admin/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  ok(response.status === 200, `login ${username}: ${response.status} ${response.text}`);
  ok(response.data?.accessToken, `login ${username}: missing accessToken`);
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  const refreshCookie = setCookie.split(';')[0];
  return { ...response.data, refreshCookie, response };
}

async function cleanup(admin) {
  const [keys, models, providers, rules, policies, users] = await Promise.all([
    request('/api/admin/keys', { token: admin }),
    request('/api/admin/models', { token: admin }),
    request('/api/admin/providers', { token: admin }),
    request('/api/admin/sensitive/rules', { token: admin }),
    request('/api/admin/sensitive/policies', { token: admin }),
    request('/api/admin/users', { token: admin }),
  ]);
  for (const key of keys.data || []) {
    if (String(key.name || '').startsWith('reg-')) {
      await request(`/api/admin/keys/${key.id}`, { method: 'DELETE', token: admin });
    }
  }
  for (const model of models.data || []) {
    if (String(model.name || '').startsWith('reg-')) {
      await request(`/api/admin/models/${model.id}`, { method: 'DELETE', token: admin });
    }
  }
  for (const provider of providers.data || []) {
    if (String(provider.name || '').startsWith('reg-')) {
      await request(`/api/admin/providers/${provider.id}`, { method: 'DELETE', token: admin });
    }
  }
  for (const policy of policies.data || []) {
    if (!policy.isDefault && String(policy.name || '').startsWith('reg-')) {
      await request(`/api/admin/sensitive/policies/${policy.id}`, { method: 'DELETE', token: admin });
    }
  }
  for (const rule of rules.data || []) {
    if (!rule.isBuiltin && String(rule.name || '').startsWith('reg-')) {
      await request(`/api/admin/sensitive/rules/${rule.id}`, { method: 'DELETE', token: admin });
    }
  }
  for (const user of users.data || []) {
    if (String(user.username || '').startsWith('reg-')) {
      await request(`/api/admin/users/${user.id}`, { method: 'DELETE', token: admin });
    }
  }
}

async function createProvider(admin, name, type, baseUrl, apiKey = 'mock-secret-key') {
  const response = await request('/api/admin/providers', {
    method: 'POST',
    token: admin,
    body: { name, type, baseUrl, apiKey, timeoutMs: 30000 },
  });
  ok(response.status === 201, `create provider ${name}: ${response.status} ${response.text}`);
  ok(response.data.hasApiKey === true, `provider ${name}: key not stored`);
  ok(!response.text.includes(apiKey), `provider ${name}: plaintext secret leaked in response`);
  return response.data;
}

async function addProviderModel(admin, providerId, upstreamModel) {
  const response = await request(`/api/admin/providers/${providerId}/models`, {
    method: 'POST',
    token: admin,
    body: { upstreamModel, displayName: upstreamModel, capabilities: ['chat'] },
  });
  ok(response.status === 201, `add provider model ${upstreamModel}: ${response.status} ${response.text}`);
  return response.data;
}

async function createModel(admin, name, providerModelId) {
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
    body: { providerModelId, priority: 10, weight: 100, enabled: true },
  });
  ok(route.status === 201, `create route ${name}: ${route.status} ${route.text}`);
  return model.data;
}

async function createKey(admin, name, modelIds, extra = {}) {
  const response = await request('/api/admin/keys', {
    method: 'POST',
    token: admin,
    body: {
      name,
      modelIds,
      ipAllowlist: ['0.0.0.0/0'],
      rpmLimit: 100,
      concurrencyLimit: 5,
      logBody: true,
      ...extra,
    },
  });
  ok(response.status === 201, `create key ${name}: ${response.status} ${response.text}`);
  ok(response.data.secret?.startsWith('sk-gw-'), `key ${name}: missing secret`);
  return response.data;
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

async function waitForLog(admin, requestId) {
  for (let i = 0; i < 20; i++) {
    const response = await request(`/api/admin/logs?requestId=${encodeURIComponent(requestId)}`, {
      token: admin,
    });
    if (response.status === 200 && response.data.items?.length) return response.data.items[0];
    await sleep(150);
  }
  throw new Error(`log for ${requestId} not found`);
}

async function main() {
  console.log(`\nAPI feature regression`);
  console.log(`  base: ${BASE_URL}`);
  console.log(`  mock: ${MOCK_ORIGIN}`);
  console.log(`  data prefix: ${prefix}\n`);

  const health = await request('/health');
  ok(health.status === 200 && health.data.db && health.data.redis, 'health check failed');
  console.log('✓ health');

  const admin = await login(ADMIN_USER, ADMIN_PASS);
  const viewer = await login(VIEWER_USER, VIEWER_PASS);
  ok(admin.user.role === 'ADMIN', 'admin role mismatch');
  ok(viewer.user.role === 'VIEWER', 'viewer role mismatch');
  console.log('✓ login admin + viewer');

  await cleanup(admin.accessToken);
  console.log('✓ cleanup old regression data');

  let mainKey;
  let mainSecret;
  try {
    await test('auth refresh rotation + logout revocation', async () => {
      const refresh = await request('/api/admin/auth/refresh', {
        method: 'POST',
        cookie: admin.refreshCookie,
      });
      ok(refresh.status === 200, `refresh: ${refresh.status} ${refresh.text}`);
      ok(refresh.data.accessToken, 'refresh: missing access token');
      const newCookie =
        (refresh.headers.getSetCookie?.()[0] || refresh.headers.get('set-cookie') || '').split(';')[0];
      ok(newCookie.startsWith('ag_refresh='), 'refresh: cookie not rotated');
      const logout = await request('/api/admin/auth/logout', {
        method: 'POST',
        cookie: newCookie,
      });
      ok(logout.status === 200, `logout: ${logout.status} ${logout.text}`);
      const revoked = await request('/api/admin/auth/refresh', {
        method: 'POST',
        cookie: newCookie,
      });
      ok(revoked.status === 401, `revoked refresh expected 401, got ${revoked.status}`);
    });

    await test('user CRUD + password change', async () => {
      const username = `${prefix}-user`;
      const created = await request('/api/admin/users', {
        method: 'POST',
        token: admin.accessToken,
        body: {
          username,
          password: 'RegPass123!',
          displayName: 'Regression User',
          role: 'VIEWER',
        },
      });
      ok(created.status === 201, `create user: ${created.status} ${created.text}`);
      const updated = await request(`/api/admin/users/${created.data.id}`, {
        method: 'PATCH',
        token: admin.accessToken,
        body: { displayName: 'Regression User Updated' },
      });
      ok(updated.status === 200, `update user: ${updated.status} ${updated.text}`);
      const temp = await login(username, 'RegPass123!');
      const changed = await request('/api/admin/auth/password', {
        method: 'PUT',
        token: temp.accessToken,
        body: { currentPassword: 'RegPass123!', newPassword: 'RegPass456!' },
      });
      ok(changed.status === 200, `change password: ${changed.status} ${changed.text}`);
      const oldLogin = await request('/api/admin/auth/login', {
        method: 'POST',
        body: { username, password: 'RegPass123!' },
      });
      ok(oldLogin.status === 401, `old password expected 401, got ${oldLogin.status}`);
      const newLogin = await login(username, 'RegPass456!');
      ok(newLogin.user.username === username, 'new password login failed');
      const removed = await request(`/api/admin/users/${created.data.id}`, {
        method: 'DELETE',
        token: admin.accessToken,
      });
      ok(removed.status === 200, `delete user: ${removed.status} ${removed.text}`);
    });

    let openai;
    let anthropic;
    let gemini;
    let modelGpt;
    let modelClaude;
    let modelGemini;

    await test('provider CRUD + secret masking + test + sync + manual models', async () => {
      openai = await createProvider(
        admin.accessToken,
        `${prefix}-openai`,
        'OPENAI',
        `${MOCK_ORIGIN}/v1`,
      );
      const updated = await request(`/api/admin/providers/${openai.id}`, {
        method: 'PATCH',
        token: admin.accessToken,
        body: { weight: 88, priority: 9 },
      });
      ok(updated.status === 200 && updated.data.weight === 88, 'provider update failed');
      const tested = await request(`/api/admin/providers/${openai.id}/test`, {
        method: 'POST',
        token: admin.accessToken,
      });
      ok(tested.status === 201 && tested.data.ok === true, `provider test: ${tested.text}`);
      const synced = await request(`/api/admin/providers/${openai.id}/sync-models`, {
        method: 'POST',
        token: admin.accessToken,
      });
      ok(synced.status === 201 && synced.data.count >= 1, `provider sync: ${synced.text}`);
      const detail = await request(`/api/admin/providers/${openai.id}`, {
        token: admin.accessToken,
      });
      const gpt = detail.data.models.find((m) => m.upstreamModel === 'mock-gpt');
      ok(gpt, 'synced mock-gpt missing');

      const manual = await addProviderModel(admin.accessToken, openai.id, `${prefix}-manual`);
      const manualUpdated = await request(
        `/api/admin/providers/${openai.id}/models/${manual.id}`,
        {
          method: 'PATCH',
          token: admin.accessToken,
          body: { displayName: 'Manual Updated', enabled: false },
        },
      );
      ok(manualUpdated.status === 200, `manual model update: ${manualUpdated.text}`);
      const manualDeleted = await request(
        `/api/admin/providers/${openai.id}/models/${manual.id}`,
        { method: 'DELETE', token: admin.accessToken },
      );
      ok(manualDeleted.status === 200, `manual model delete: ${manualDeleted.text}`);

      anthropic = await createProvider(
        admin.accessToken,
        `${prefix}-anthropic`,
        'ANTHROPIC',
        `${MOCK_ORIGIN}/v1`,
      );
      const claudeUpstream = await addProviderModel(
        admin.accessToken,
        anthropic.id,
        'mock-claude',
      );
      const anthropicTest = await request(`/api/admin/providers/${anthropic.id}/test`, {
        method: 'POST',
        token: admin.accessToken,
        body: { model: 'mock-claude' },
      });
      ok(anthropicTest.status === 201 && anthropicTest.data.ok === true, `anthropic test: ${anthropicTest.text}`);

      gemini = await createProvider(
        admin.accessToken,
        `${prefix}-gemini`,
        'GEMINI',
        `${MOCK_ORIGIN}/v1beta`,
      );
      const geminiUpstream = await addProviderModel(admin.accessToken, gemini.id, 'mock-gemini');
      const geminiTest = await request(`/api/admin/providers/${gemini.id}/test`, {
        method: 'POST',
        token: admin.accessToken,
      });
      ok(geminiTest.status === 201 && geminiTest.data.ok === true, `gemini test: ${geminiTest.text}`);

      // Save IDs for later groups.
      openai._gptUpstream = gpt;
      anthropic._claudeUpstream = claudeUpstream;
      gemini._geminiUpstream = geminiUpstream;
    });

    await test('model CRUD + route update/delete', async () => {
      const gptUpstream = await request(`/api/admin/providers/${openai.id}`, {
        token: admin.accessToken,
      }).then((r) => r.data.models.find((m) => m.upstreamModel === 'mock-gpt'));
      modelGpt = await createModel(admin.accessToken, `${prefix}-gpt`, gptUpstream.id);
      modelClaude = await createModel(
        admin.accessToken,
        `${prefix}-claude`,
        anthropic._claudeUpstream.id,
      );
      modelGemini = await createModel(
        admin.accessToken,
        `${prefix}-gemini`,
        gemini._geminiUpstream.id,
      );
      const updated = await request(`/api/admin/models/${modelGpt.id}`, {
        method: 'PATCH',
        token: admin.accessToken,
        body: { displayName: 'Regression GPT Updated', outputPrice: 3.5, enabled: true },
      });
      ok(updated.status === 200 && updated.data.displayName === 'Regression GPT Updated', 'model update failed');
      const detail = await request(`/api/admin/models/${modelGpt.id}`, {
        token: admin.accessToken,
      });
      const route = detail.data.routes[0];
      ok(route, 'model route missing');
      const routeUpdated = await request(`/api/admin/models/${modelGpt.id}/routes/${route.id}`, {
        method: 'PATCH',
        token: admin.accessToken,
        body: { priority: 5, weight: 70 },
      });
      ok(routeUpdated.status === 200 && routeUpdated.data.priority === 5, 'route update failed');
      const routeDeleted = await request(`/api/admin/models/${modelGpt.id}/routes/${route.id}`, {
        method: 'DELETE',
        token: admin.accessToken,
      });
      ok(routeDeleted.status === 200, 'route delete failed');
      const routeAgain = await request(`/api/admin/models/${modelGpt.id}/routes`, {
        method: 'POST',
        token: admin.accessToken,
        body: { providerModelId: route.providerModelId, priority: 5, weight: 70 },
      });
      ok(routeAgain.status === 201, `route re-create: ${routeAgain.text}`);
    });

    await test('key issue + model ACL + usage + lifecycle', async () => {
      mainKey = await createKey(admin.accessToken, `${prefix}-key`, [
        modelGpt.id,
        modelClaude.id,
        modelGemini.id,
      ], { rpmLimit: 200, tpmLimit: 100000, dailyRequestLimit: 1000, quotaRequests: 1000 });
      mainSecret = mainKey.secret;

      const list = await request('/api/admin/keys', { token: admin.accessToken });
      ok(list.status === 200 && list.data.some((k) => k.id === mainKey.id), 'key list missing');
      const got = await request(`/api/admin/keys/${mainKey.id}`, { token: admin.accessToken });
      ok(got.status === 200, 'key detail failed');
      const updated = await request(`/api/admin/keys/${mainKey.id}`, {
        method: 'PATCH',
        token: admin.accessToken,
        body: { name: `${prefix}-key-updated`, note: 'regression' },
      });
      ok(updated.status === 200 && updated.data.name === `${prefix}-key-updated`, 'key update failed');

      const models = await request('/v1/models', { token: mainSecret });
      ok(models.status === 200 && models.data.data.length === 3, `v1/models: ${models.text}`);

      const disabled = await request(`/api/admin/keys/${mainKey.id}/disable`, {
        method: 'POST',
        token: admin.accessToken,
      });
      ok(disabled.status === 201, 'key disable failed');
      const disabledCall = await chat(mainSecret, modelGpt.name, 'disabled');
      ok(disabledCall.status === 403, `disabled key expected 403, got ${disabledCall.status}`);
      const enabled = await request(`/api/admin/keys/${mainKey.id}/enable`, {
        method: 'POST',
        token: admin.accessToken,
      });
      ok(enabled.status === 201, 'key enable failed');

      const rotated = await request(`/api/admin/keys/${mainKey.id}/rotate`, {
        method: 'POST',
        token: admin.accessToken,
      });
      ok(rotated.status === 201 && rotated.data.secret?.startsWith('sk-gw-'), 'key rotate failed');
      const oldCall = await chat(mainSecret, modelGpt.name, 'old');
      ok(oldCall.status === 401, `old rotated key expected 401, got ${oldCall.status}`);
      mainSecret = rotated.data.secret;
      const newCall = await chat(mainSecret, modelGpt.name, 'new');
      ok(newCall.status === 200, `new rotated key: ${newCall.status} ${newCall.text}`);

      const usage = await request(`/api/admin/keys/${mainKey.id}/usage`, {
        token: admin.accessToken,
      });
      ok(usage.status === 200 && usage.data.key, 'key usage failed');

      const lifecycle = await createKey(admin.accessToken, `${prefix}-revoke`, [modelGpt.id]);
      const revoked = await request(`/api/admin/keys/${lifecycle.id}/revoke`, {
        method: 'POST',
        token: admin.accessToken,
      });
      ok(revoked.status === 201, 'key revoke failed');
      const revokedCall = await chat(lifecycle.secret, modelGpt.name, 'revoked');
      ok(revokedCall.status === 403, `revoked key expected 403, got ${revokedCall.status}`);
      const deleted = await request(`/api/admin/keys/${lifecycle.id}`, {
        method: 'DELETE',
        token: admin.accessToken,
      });
      ok(deleted.status === 200, 'key delete failed');
    });

    await test('gateway protocols: OpenAI non-stream/stream + Anthropic + Gemini', async () => {
      const nonStream = await chat(mainSecret, modelGpt.name, '回归测试：非流式');
      ok(nonStream.status === 200, `non-stream: ${nonStream.status} ${nonStream.text}`);
      ok(nonStream.data.choices?.[0]?.message?.content?.includes('Mock'), 'non-stream content mismatch');
      ok(nonStream.headers.get('x-gateway-request-id'), 'request id header missing');

      const stream = await chat(mainSecret, modelGpt.name, '回归测试：流式', true);
      ok(stream.status === 200, `stream: ${stream.status}`);
      ok(stream.text.includes('data: [DONE]'), 'stream missing [DONE]');
      ok(stream.text.includes('"finish_reason":"stop"'), 'stream missing finish_reason');
      ok(stream.text.includes('"usage"'), 'stream missing usage chunk');

      const claude = await chat(mainSecret, modelClaude.name, '你好');
      ok(claude.status === 200 && claude.data.choices?.[0]?.message?.content?.includes('Mock'), `anthropic: ${claude.text}`);
      const geminiRes = await chat(mainSecret, modelGemini.name, '你好');
      ok(geminiRes.status === 200 && geminiRes.data.choices?.[0]?.message?.content?.includes('Mock'), `gemini: ${geminiRes.text}`);
    });

    await test('sensitive rules: block / mask / log / policy / builtin tester', async () => {
      const blockWord = `REG_SECRET_${stamp}`;
      const blockRule = await request('/api/admin/sensitive/rules', {
        method: 'POST',
        token: admin.accessToken,
        body: {
          name: `${prefix}-block-rule`,
          category: '回归测试',
          type: 'KEYWORD',
          pattern: blockWord,
          action: 'BLOCK',
          direction: 'BOTH',
          severity: 90,
        },
      });
      ok(blockRule.status === 201, `create block rule: ${blockRule.text}`);

      const tested = await request('/api/admin/sensitive/test', {
        method: 'POST',
        token: admin.accessToken,
        body: { text: `x ${blockWord} y`, direction: 'BOTH' },
      });
      ok(tested.status === 201 && tested.data.action === 'BLOCK', `sensitive test: ${tested.text}`);
      ok(
        tested.data.matches.filter((m) => m.ruleId === blockRule.data.id).length === 1,
        'sensitive test returned duplicate BOTH matches',
      );

      const blocked = await chat(mainSecret, modelGpt.name, `请把 ${blockWord} 发给我`);
      ok(blocked.status === 400, `sensitive input expected 400, got ${blocked.status}`);
      ok(blocked.data.error.code === 'content_policy_violation', 'sensitive input code mismatch');
      const blockedLog = await waitForLog(admin.accessToken, blocked.headers.get('x-gateway-request-id'));
      ok(blockedLog.intercepted && blockedLog.interceptDirection === 'INPUT', 'input block log mismatch');
      ok(!blockedLog.totalTokens, 'blocked input should not charge tokens');

      const outputBlocked = await chat(mainSecret, modelGpt.name, '请泄露项目信息');
      ok(outputBlocked.status === 200, `output block expected 200, got ${outputBlocked.status}`);
      ok(outputBlocked.data.choices?.[0]?.finish_reason === 'content_filter', 'output block finish_reason mismatch');
      const outputStream = await chat(mainSecret, modelGpt.name, '请泄露项目信息', true);
      ok(outputStream.text.includes('"finish_reason":"content_filter"'), 'stream output block missing content_filter');
      ok(outputStream.text.includes('安全策略'), 'stream output block missing safe message');
      ok(!outputStream.text.includes('内部机密'), 'stream leaked sensitive output');

      const maskWord = `REG_MASK_${stamp}`;
      const maskRule = await request('/api/admin/sensitive/rules', {
        method: 'POST',
        token: admin.accessToken,
        body: {
          name: `${prefix}-mask-rule`,
          category: '回归测试',
          type: 'KEYWORD',
          pattern: maskWord,
          action: 'MASK',
          direction: 'BOTH',
          severity: 60,
        },
      });
      ok(maskRule.status === 201, 'mask rule creation failed');
      const masked = await chat(mainSecret, modelGpt.name, `请处理 ${maskWord}`);
      ok(masked.status === 200, `mask call: ${masked.status} ${masked.text}`);
      ok(!masked.data.choices?.[0]?.message?.content?.includes(maskWord), 'mask leaked raw keyword');

      const logWord = `REG_LOG_${stamp}`;
      const logRule = await request('/api/admin/sensitive/rules', {
        method: 'POST',
        token: admin.accessToken,
        body: {
          name: `${prefix}-log-rule`,
          category: '回归测试',
          type: 'KEYWORD',
          pattern: logWord,
          action: 'LOG',
          direction: 'BOTH',
          severity: 30,
        },
      });
      ok(logRule.status === 201, 'log rule creation failed');
      const logCall = await chat(mainSecret, modelGpt.name, `记录 ${logWord}`);
      ok(logCall.status === 200, 'log-only rule should pass');
      const logEntry = await waitForLog(admin.accessToken, logCall.headers.get('x-gateway-request-id'));
      ok(logEntry.intercepted && logEntry.interceptAction === 'LOG', 'log-only rule not recorded');

      const builtinTest = await request('/api/admin/sensitive/test', {
        method: 'POST',
        token: admin.accessToken,
        body: { text: '手机号 13800138000', direction: 'BOTH' },
      });
      ok(builtinTest.status === 201 && builtinTest.data.action === 'MASK', 'builtin PII test failed');

      const policy = await request('/api/admin/sensitive/policies', {
        method: 'POST',
        token: admin.accessToken,
        body: {
          name: `${prefix}-policy`,
          description: 'regression policy',
          ruleIds: [blockRule.data.id, maskRule.data.id],
        },
      });
      ok(policy.status === 201, `policy create: ${policy.text}`);
      const policyDetail = await request(`/api/admin/sensitive/policies/${policy.data.id}`, {
        token: admin.accessToken,
      });
      ok(policyDetail.status === 200 && policyDetail.data.rules.length === 2, 'policy detail mismatch');
      const policyUpdated = await request(`/api/admin/sensitive/policies/${policy.data.id}`, {
        method: 'PATCH',
        token: admin.accessToken,
        body: { description: 'regression policy updated' },
      });
      ok(policyUpdated.status === 200, 'policy update failed');
      const policyDeleted = await request(`/api/admin/sensitive/policies/${policy.data.id}`, {
        method: 'DELETE',
        token: admin.accessToken,
      });
      ok(policyDeleted.status === 200, 'policy delete failed');

      for (const rule of [blockRule.data, maskRule.data, logRule.data]) {
        await request(`/api/admin/sensitive/rules/${rule.id}`, {
          method: 'DELETE',
          token: admin.accessToken,
        });
      }
    });

    await test('IP / model / RPM / daily / TPM / quota limits', async () => {
      const ipKey = await createKey(admin.accessToken, `${prefix}-ip`, [modelGpt.id], {
        ipAllowlist: ['10.0.0.1'],
      });
      const ipDenied = await chat(ipKey.secret, modelGpt.name, 'ip');
      ok(ipDenied.status === 403 && ipDenied.data.error.code === 'ip_not_allowed', `IP deny: ${ipDenied.status} ${ipDenied.text}`);

      const noModelKey = await createKey(admin.accessToken, `${prefix}-nomodel`, []);
      const modelDenied = await chat(noModelKey.secret, modelGpt.name, 'model');
      ok(modelDenied.status === 403 && modelDenied.data.error.code === 'model_not_allowed', `model deny: ${modelDenied.status}`);

      const rateKey = await createKey(admin.accessToken, `${prefix}-rpm`, [modelGpt.id], {
        rpmLimit: 2,
        concurrencyLimit: 1,
        dailyRequestLimit: 100,
      });
      const r1 = await chat(rateKey.secret, modelGpt.name, '1');
      const r2 = await chat(rateKey.secret, modelGpt.name, '2');
      const r3 = await chat(rateKey.secret, modelGpt.name, '3');
      ok(r1.status === 200 && r2.status === 200, `RPM setup: ${r1.status}/${r2.status}`);
      ok(r3.status === 429 && r3.data.error.code === 'rate_limit_exceeded', `RPM limit: ${r3.status} ${r3.text}`);
      ok(Number(r3.headers.get('retry-after')) > 0, 'RPM missing retry-after');

      const dailyKey = await createKey(admin.accessToken, `${prefix}-daily`, [modelGpt.id], {
        rpmLimit: 100,
        dailyRequestLimit: 1,
      });
      const d1 = await chat(dailyKey.secret, modelGpt.name, '1');
      const d2 = await chat(dailyKey.secret, modelGpt.name, '2');
      ok(d1.status === 200, `daily first: ${d1.status}`);
      ok(d2.status === 429, `daily limit: ${d2.status} ${d2.text}`);

      const tpmKey = await createKey(admin.accessToken, `${prefix}-tpm`, [modelGpt.id], {
        rpmLimit: 100,
        tpmLimit: 1,
      });
      const tpm = await chat(tpmKey.secret, modelGpt.name, '这是一段足够长的文本，用来触发每分鐘 Token 限制');
      ok(tpm.status === 429, `TPM limit: ${tpm.status} ${tpm.text}`);

      const quotaKey = await createKey(admin.accessToken, `${prefix}-quota`, [modelGpt.id], {
        rpmLimit: 100,
        quotaRequests: 1,
      });
      const q1 = await chat(quotaKey.secret, modelGpt.name, '1');
      const q2 = await chat(quotaKey.secret, modelGpt.name, '2');
      ok(q1.status === 200, `quota first: ${q1.status}`);
      ok(q2.status === 429 && q2.data.error.code === 'insufficient_quota', `quota limit: ${q2.status} ${q2.text}`);

      const invalid = await chat(`${prefix}-invalid`, modelGpt.name, 'x');
      ok(invalid.status === 401, `invalid key: ${invalid.status}`);
    });

    await test('logs filter/detail/export + stats + settings + audit', async () => {
      const call = await chat(mainSecret, modelGpt.name, '日志回归');
      ok(call.status === 200, 'log fixture call failed');
      const log = await waitForLog(admin.accessToken, call.headers.get('x-gateway-request-id'));
      ok(log.keyName?.includes('reg-'), 'log key snapshot mismatch');
      const detail = await request(`/api/admin/logs/${log.id}`, { token: admin.accessToken });
      ok(detail.status === 200 && detail.data.body?.requestBody, 'log detail/body missing');
      const filtered = await request('/api/admin/logs?status=SUCCESS&intercepted=false&pageSize=5', {
        token: admin.accessToken,
      });
      ok(filtered.status === 200 && filtered.data.items.length > 0, 'log filters failed');
      const csv = await request('/api/admin/logs/export?pageSize=5', {
        token: admin.accessToken,
        raw: true,
      });
      ok(csv.status === 200 && String(csv.headers.get('content-type')).includes('text/csv'), 'CSV export failed');
      ok(csv.text.includes('requestId,createdAt'), 'CSV header missing');

      const overview = await request('/api/admin/stats/overview?range=24h', { token: admin.accessToken });
      ok(overview.status === 200 && overview.data.requests > 0, 'stats overview failed');
      const series = await request('/api/admin/stats/timeseries?range=24h', { token: admin.accessToken });
      ok(series.status === 200 && Array.isArray(series.data), 'stats timeseries failed');
      const top = await request('/api/admin/stats/top?range=24h', { token: admin.accessToken });
      ok(top.status === 200 && Array.isArray(top.data.models), 'stats top failed');
      const recent = await request('/api/admin/stats/recent', { token: admin.accessToken });
      ok(recent.status === 200 && Array.isArray(recent.data), 'stats recent failed');

      const settings = await request('/api/admin/settings', { token: admin.accessToken });
      ok(settings.status === 200 && typeof settings.data.siteName === 'string', 'settings get failed');
      const settingsUpdated = await request('/api/admin/settings', {
        method: 'PUT',
        token: admin.accessToken,
        body: { siteName: settings.data.siteName, logRetentionDays: settings.data.logRetentionDays },
      });
      ok(settingsUpdated.status === 200, 'settings update failed');

      const audit = await request('/api/admin/audit-logs?pageSize=20', { token: admin.accessToken });
      ok(audit.status === 200 && audit.data.items.length > 0, 'audit log list failed');
    });

    await test('admin playground SSE', async () => {
      const response = await request('/api/admin/playground/chat', {
        method: 'POST',
        token: admin.accessToken,
        body: {
          keyId: mainKey.id,
          model: modelGpt.name,
          messages: [{ role: 'user', content: 'Playground 回归' }],
          stream: true,
          stream_options: { include_usage: true },
        },
        raw: true,
      });
      ok(response.status === 200, `playground: ${response.status} ${response.text.slice(0, 200)}`);
      ok(response.text.includes('chat.completion.chunk'), 'playground missing chunks');
      ok(response.text.includes('[DONE]'), 'playground missing [DONE]');
    });

    await test('viewer read permissions + write rejection', async () => {
      for (const path of [
        '/api/admin/providers',
        '/api/admin/models',
        '/api/admin/keys',
        '/api/admin/logs?pageSize=1',
        '/api/admin/sensitive/rules',
        '/api/admin/sensitive/policies',
        '/api/admin/settings',
        '/api/admin/audit-logs?pageSize=1',
      ]) {
        const response = await request(path, { token: viewer.accessToken });
        ok(response.status === 200, `viewer GET ${path}: ${response.status}`);
      }
      const writeProvider = await request('/api/admin/providers', {
        method: 'POST',
        token: viewer.accessToken,
        body: { name: `${prefix}-should-fail`, type: 'OPENAI', baseUrl: `${MOCK_ORIGIN}/v1` },
      });
      ok(writeProvider.status === 403, `viewer provider write: ${writeProvider.status}`);
      const writeUser = await request('/api/admin/users', {
        method: 'POST',
        token: viewer.accessToken,
        body: { username: `${prefix}-should-fail`, password: 'RegPass123!', role: 'VIEWER' },
      });
      ok(writeUser.status === 403, `viewer user write: ${writeUser.status}`);
      const writeSettings = await request('/api/admin/settings', {
        method: 'PUT',
        token: viewer.accessToken,
        body: { siteName: 'forbidden' },
      });
      ok(writeSettings.status === 403, `viewer settings write: ${writeSettings.status}`);
    });
  } finally {
    await cleanup(admin.accessToken);
    console.log('✓ regression data cleaned up');
  }

  console.log(`\n========================================`);
  console.log(`API regression: ${passed} assertions passed, ${failed} failed`);
  console.log(`========================================\n`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error('\nAPI regression crashed');
  console.error(error?.stack || error);
  process.exit(1);
});
