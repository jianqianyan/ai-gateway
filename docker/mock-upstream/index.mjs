import http from 'node:http';

const PORT = Number(process.env.PORT || 4010);

const models = [
  { id: 'mock-gpt', object: 'model', owned_by: 'mock' },
  { id: 'mock-fast', object: 'model', owned_by: 'mock' },
  { id: 'mock-claude', object: 'model', owned_by: 'mock' },
  { id: 'mock-gemini', object: 'model', owned_by: 'mock' },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function lastUserText(body) {
  const messages = body.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
    }
  }
  return '';
}

function answerFor(body) {
  const text = lastUserText(body);
  if (text.includes('泄露') || text.includes('output-secret')) {
    return '这是内部机密：项目代号是 ORION-7，请不要外传。';
  }
  if (text.includes('敏感')) {
    return '已收到，我会谨慎处理。';
  }
  return `你好！我是 Mock 上游（${body.model || 'unknown'}）。你刚才说：${text.slice(0, 300)}`;
}

function openAiResponse(body) {
  const text = answerFor(body);
  return {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || 'mock-gpt',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: Math.max(1, Math.ceil(lastUserText(body).length / 3)),
      completion_tokens: Math.max(1, Math.ceil(text.length / 3)),
      total_tokens: Math.max(1, Math.ceil(lastUserText(body).length / 3)) + Math.max(1, Math.ceil(text.length / 3)),
    },
  };
}

async function handleOpenAi(req, res, body) {
  const answer = answerFor(body);
  if (!body.stream) {
    return sendJson(res, 200, openAiResponse(body));
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const id = `chatcmpl-mock-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunks = [];
  const pieces = answer.match(/.{1,4}/gs) || [answer];
  for (const piece of pieces) chunks.push(piece);

  sse(res, {
    id,
    object: 'chat.completion.chunk',
    created,
    model: body.model || 'mock-gpt',
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });

  for (const piece of chunks) {
    sse(res, {
      id,
      object: 'chat.completion.chunk',
      created,
      model: body.model || 'mock-gpt',
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    });
    await new Promise((r) => setTimeout(r, 5));
  }

  sse(res, {
    id,
    object: 'chat.completion.chunk',
    created,
    model: body.model || 'mock-gpt',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });

  if (body.stream_options?.include_usage) {
    sse(res, {
      id,
      object: 'chat.completion.chunk',
      created,
      model: body.model || 'mock-gpt',
      choices: [],
      usage: {
        prompt_tokens: Math.max(1, Math.ceil(lastUserText(body).length / 3)),
        completion_tokens: Math.max(1, Math.ceil(answer.length / 3)),
        total_tokens: Math.max(1, Math.ceil(lastUserText(body).length / 3)) + Math.max(1, Math.ceil(answer.length / 3)),
      },
    });
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleAnthropic(req, res, body) {
  const input = lastUserText({ messages: body.messages || [] });
  const text = answerFor({ model: body.model, messages: body.messages || [] });
  if (!body.stream) {
    return sendJson(res, 200, {
      id: `msg_mock_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: body.model || 'mock-claude',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: Math.max(1, Math.ceil(input.length / 3)), output_tokens: Math.max(1, Math.ceil(text.length / 3)) },
    });
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('message_start', {
    type: 'message_start',
    message: {
      id: `msg_mock_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: body.model || 'mock-claude',
      content: [],
      stop_reason: null,
      usage: { input_tokens: Math.max(1, Math.ceil(input.length / 3)), output_tokens: 0 },
    },
  });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (const piece of text.match(/.{1,4}/gs) || [text]) {
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } });
    await new Promise((r) => setTimeout(r, 5));
  }
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: Math.max(1, Math.ceil(text.length / 3)) },
  });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

async function handleGemini(req, res, body, modelName) {
  const parts = [];
  for (const c of body.contents || []) {
    for (const p of c.parts || []) {
      if (p.text) parts.push(p.text);
    }
  }
  const input = parts.join('\n');
  const text = answerFor({ model: modelName, messages: [{ role: 'user', content: input }] });

  if (req.url.includes(':streamGenerateContent')) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    for (const piece of text.match(/.{1,4}/gs) || [text]) {
      sse(res, {
        candidates: [{ content: { role: 'model', parts: [{ text: piece }] }, finishReason: null, index: 0 }],
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    sse(res, {
      candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: {
        promptTokenCount: Math.max(1, Math.ceil(input.length / 3)),
        candidatesTokenCount: Math.max(1, Math.ceil(text.length / 3)),
        totalTokenCount: Math.max(1, Math.ceil(input.length / 3)) + Math.max(1, Math.ceil(text.length / 3)),
      },
    });
    res.end();
    return;
  }

  sendJson(res, 200, {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: {
      promptTokenCount: Math.max(1, Math.ceil(input.length / 3)),
      candidatesTokenCount: Math.max(1, Math.ceil(text.length / 3)),
      totalTokenCount: Math.max(1, Math.ceil(input.length / 3)) + Math.max(1, Math.ceil(text.length / 3)),
    },
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      return sendJson(res, 200, { object: 'list', data: models });
    }

    if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
      const body = await readBody(req);
      return handleOpenAi(req, res, body);
    }

    if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
      const body = await readBody(req);
      return handleAnthropic(req, res, body);
    }

    const gemini = req.url.match(/^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)/);
    if (req.method === 'POST' && gemini) {
      const body = await readBody(req);
      return handleGemini(req, res, body, decodeURIComponent(gemini[1]));
    }

    if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) {
      return sendJson(res, 200, {
        models: models.map((m) => ({ name: `models/${m.id}`, displayName: m.id })),
      });
    }

    sendJson(res, 404, { error: { message: `mock upstream: no route ${req.method} ${req.url}` } });
  } catch (e) {
    sendJson(res, 500, { error: { message: e.message } });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`mock upstream listening on ${PORT}`);
});
