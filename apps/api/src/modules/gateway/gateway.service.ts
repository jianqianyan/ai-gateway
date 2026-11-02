import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InterceptDirection,
  KeyStatus,
  Prisma,
  ProviderHealth,
  RequestStatus,
  SensitiveAction,
  SensitiveDirection,
} from '@prisma/client';
import type { Request, Response } from 'express';
import { PrismaService } from '../../core/prisma.service';
import { KeysService } from '../keys/keys.service';
import { ModelsService } from '../models/models.service';
import { ProvidersService } from '../providers/providers.service';
import { SensitiveService } from '../sensitive/sensitive.service';
import { LogsService } from '../logs/logs.service';
import { RateLimitService } from './rate-limit.service';
import { AdapterFactory } from './adapters/adapter.factory';
import { UpstreamError } from './upstream-error';
import { AdapterArgs, StreamEvent, Usage, extractOpenAiText, openAiChunk } from './types';
import { GatewayError } from '../../common/errors';
import { isIpAllowed } from '../../common/utils/ip';
import { calcCost, estimateTokens } from '../../common/utils/tokens';
import { sanitizeForAudit } from '../../common/utils/redact';
import { logger } from '../../common/logger';
import { RuleLike, SensitiveMatch } from '../sensitive/matcher';

const SAFE_OUTPUT = '抱歉，输出内容触发了安全策略，已被拦截。';
const SAFE_INPUT_MESSAGE = '请求内容触发了安全策略，已被拦截。如有疑问请联系管理员并提供 request_id。';

interface TextItem {
  path: (string | number)[];
  text: string;
}

interface InterceptState {
  direction: 'INPUT' | 'OUTPUT';
  action: SensitiveAction;
  matches: SensitiveMatch[];
}

interface GatewayContext {
  requestId: string;
  key: any;
  model: any;
  body: any;
  req: Request;
  res: Response;
  startedAt: number;
  source?: string;
  endpoint: string;
  stream: boolean;
  policyRules: RuleLike[];
  attempts: any[];
  usage: Usage;
  usageEstimated: boolean;
  upstreamRequestId?: string;
  provider: any;
  upstreamModel?: string;
  sentText: string;
  firstTokenAt: number | null;
  intercept: InterceptState | null;
  abortController: AbortController;
  clientClosed: boolean;
  responseBytes: number;
  responseBody: any;
  finalSent: boolean;
}

function extractBearer(req: Request): string {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function getByPath(root: any, path: (string | number)[]) {
  let cur = root;
  for (const p of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(root: any, path: (string | number)[], value: any) {
  if (!path.length) return;
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur?.[path[i]];
    if (cur === null || cur === undefined) return;
  }
  cur[path[path.length - 1]] = value;
}

function collectInputTexts(body: any): TextItem[] {
  const out: TextItem[] = [];
  if (typeof body?.system === 'string' && body.system) {
    out.push({ path: ['system'], text: body.system });
  }
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  messages.forEach((m: any, i: number) => {
    if (typeof m?.content === 'string' && m.content) {
      out.push({ path: ['messages', i, 'content'], text: m.content });
    } else if (Array.isArray(m?.content)) {
      m.content.forEach((part: any, j: number) => {
        if (part?.type === 'text' && typeof part.text === 'string' && part.text) {
          out.push({ path: ['messages', i, 'content', j, 'text'], text: part.text });
        }
      });
    }
    if (Array.isArray(m?.tool_calls)) {
      m.tool_calls.forEach((call: any, j: number) => {
        const args = call?.function?.arguments;
        if (typeof args === 'string' && args) {
          out.push({
            path: ['messages', i, 'tool_calls', j, 'function', 'arguments'],
            text: args,
          });
        }
      });
    }
  });
  return out;
}

function collectOutputTexts(response: any): TextItem[] {
  const out: TextItem[] = [];
  const choices = Array.isArray(response?.choices) ? response.choices : [];
  choices.forEach((choice: any, i: number) => {
    const msg = choice?.message;
    if (!msg) return;
    if (typeof msg.content === 'string' && msg.content) {
      out.push({ path: ['choices', i, 'message', 'content'], text: msg.content });
    } else if (Array.isArray(msg.content)) {
      msg.content.forEach((part: any, j: number) => {
        if (part?.type === 'text' && typeof part.text === 'string' && part.text) {
          out.push({ path: ['choices', i, 'message', 'content', j, 'text'], text: part.text });
        }
      });
    }
    if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
      out.push({ path: ['choices', i, 'message', 'reasoning_content'], text: msg.reasoning_content });
    }
    if (Array.isArray(msg.tool_calls)) {
      msg.tool_calls.forEach((call: any, j: number) => {
        const args = call?.function?.arguments;
        if (typeof args === 'string' && args) {
          out.push({
            path: ['choices', i, 'message', 'tool_calls', j, 'function', 'arguments'],
            text: args,
          });
        }
      });
    }
  });
  return out;
}

function applyTextMasks(
  root: any,
  items: TextItem[],
  hits: { path: string; match: SensitiveMatch }[],
  replacement = '***',
) {
  const byPath = new Map<string, SensitiveMatch[]>();
  for (const hit of hits) {
    const arr = byPath.get(hit.path) || [];
    arr.push(hit.match);
    byPath.set(hit.path, arr);
  }
  for (const item of items) {
    const matches = byPath.get(JSON.stringify(item.path));
    if (matches?.length) {
      setByPath(root, item.path, applyMaskLocal(item.text, matches, replacement));
    }
  }
}

function applyMaskLocal(text: string, matches: SensitiveMatch[], replacement = '***') {
  let out = text;
  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    if (m.start < 0 || m.end > out.length) continue;
    out = out.slice(0, m.start) + replacement + out.slice(m.end);
  }
  return out;
}

function blockOutput(response: any) {
  const choices = Array.isArray(response?.choices) ? response.choices : [];
  for (const choice of choices) {
    if (!choice.message) choice.message = { role: 'assistant', content: SAFE_OUTPUT };
    choice.message.content = SAFE_OUTPUT;
    delete choice.message.tool_calls;
    delete choice.message.function_call;
    choice.finish_reason = 'content_filter';
  }
}

@Injectable()
export class GatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly keys: KeysService,
    private readonly models: ModelsService,
    private readonly providers: ProvidersService,
    private readonly sensitive: SensitiveService,
    private readonly logs: LogsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async listModels(req: Request) {
    const secret = extractBearer(req);
    const key = await this.keys.findBySecret(secret);
    if (!key) throw new GatewayError('invalid_api_key', 'Invalid API key', 401, 'authentication_error');
    this.assertKeyUsable(key);
    if (!isIpAllowed(req.ip || '', key.ipAllowlist)) {
      throw new GatewayError('ip_not_allowed', 'Client IP is not allowed', 403, 'permission_error');
    }
    const data = (key.keyModels || [])
      .filter((km: any) => km.model?.enabled)
      .map((km: any) => ({
        id: km.model.name,
        object: 'model',
        created: Math.floor(new Date(km.model.createdAt).getTime() / 1000),
        owned_by: 'ai-gateway',
      }));
    return { object: 'list', data };
  }

  async handleChat(
    req: Request,
    res: Response,
    options: { keyId?: string; source?: string; skipIpCheck?: boolean } = {},
  ) {
    const requestId = (req as any).requestId || `req_${Date.now()}`;
    res.setHeader('x-gateway-request-id', requestId);
    const body = req.body || {};
    const stream = Boolean(body.stream);
    const ctx: GatewayContext = {
      requestId,
      key: null,
      model: null,
      body,
      req,
      res,
      startedAt: Date.now(),
      source: options.source,
      endpoint: '/v1/chat/completions',
      stream,
      policyRules: [],
      attempts: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      usageEstimated: false,
      provider: null,
      sentText: '',
      firstTokenAt: null,
      intercept: null,
      abortController: new AbortController(),
      clientClosed: false,
      responseBytes: 0,
      responseBody: null,
      finalSent: false,
    };

    let status: RequestStatus = RequestStatus.ERROR;
    let httpStatus = 500;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    const onClose = () => {
      if (!res.writableEnded) {
        ctx.clientClosed = true;
        ctx.abortController.abort();
      }
    };
    res.on('close', onClose);

    try {
      ctx.key = options.keyId
        ? await this.keys.getById(options.keyId)
        : await this.keys.findBySecret(extractBearer(req));
      if (!ctx.key) {
        throw new GatewayError('invalid_api_key', 'Invalid API key', 401, 'authentication_error');
      }
      this.assertKeyUsable(ctx.key);

      if (!options.skipIpCheck && !isIpAllowed(req.ip || '', ctx.key.ipAllowlist)) {
        throw new GatewayError('ip_not_allowed', 'Client IP is not allowed', 403, 'permission_error');
      }

      if (!body.model || typeof body.model !== 'string') {
        throw new GatewayError('invalid_request_error', 'model is required', 400);
      }
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        throw new GatewayError('invalid_request_error', 'messages must be a non-empty array', 400);
      }

      ctx.model = await this.models.getRoutableByName(body.model);
      if (!ctx.model || !ctx.model.enabled) {
        throw new GatewayError('model_not_found', `Model ${body.model} is not available`, 404);
      }
      const allowed = (ctx.key.keyModels || []).some(
        (km: any) => km.modelId === ctx.model.id || km.model?.id === ctx.model.id,
      );
      if (!allowed) {
        throw new GatewayError(
          'model_not_allowed',
          `Model ${body.model} is not allowed for this API key`,
          403,
          'permission_error',
        );
      }

      const inputItems = collectInputTexts(body);
      const estimatedPrompt = inputItems.reduce((sum, item) => sum + estimateTokens(item.text), 0);
      const rl = await this.rateLimit.acquire(ctx.key, estimatedPrompt);
      for (const [k, v] of Object.entries(rl.headers)) res.setHeader(k, v);
      if (!rl.allowed) {
        const message =
          rl.reason === 'concurrency'
            ? 'Too many concurrent requests for this key'
            : rl.reason === 'daily'
              ? 'Daily request limit exceeded'
              : rl.reason === 'tpm'
                ? 'Tokens per minute limit exceeded'
                : 'Rate limit exceeded';
        throw new GatewayError('rate_limit_exceeded', message, 429, 'rate_limit_error', rl.headers);
      }
      (ctx as any).concurrencyAcquired = rl.concurrencyAcquired;

      const quota = await this.keys.checkQuota(ctx.key);
      if (!quota.ok) {
        throw new GatewayError(
          'insufficient_quota',
          quota.reason || 'Quota exceeded',
          429,
          'rate_limit_error',
        );
      }
      const consumed = await this.keys.consumeRequest(ctx.key.id);
      if (!consumed) {
        throw new GatewayError('insufficient_quota', 'Request quota exceeded', 429, 'rate_limit_error');
      }

      ctx.policyRules = await this.sensitive.getRulesForKey(ctx.key);
      const inputScan = this.sensitive.scanTexts(
        inputItems.map((item) => ({ path: JSON.stringify(item.path), text: item.text })),
        ctx.policyRules,
        'INPUT',
      );
      if (inputScan.action !== 'NONE' && inputScan.matches.length) {
        this.mergeIntercept(ctx, 'INPUT', inputScan.action as SensitiveAction, inputScan.matches);
        if (inputScan.action === SensitiveAction.MASK) {
          applyTextMasks(body, inputItems, inputScan.hits);
        } else if (inputScan.action === SensitiveAction.BLOCK) {
          throw new GatewayError(
            'content_policy_violation',
            SAFE_INPUT_MESSAGE,
            400,
            'invalid_request_error',
          );
        }
      }

      if (stream) {
        await this.processStream(ctx);
      } else {
        await this.processNonStream(ctx);
      }

      if (ctx.clientClosed) {
        status = RequestStatus.CANCELLED;
        httpStatus = 499;
      } else if (ctx.intercept?.action === SensitiveAction.BLOCK) {
        status = RequestStatus.BLOCKED;
        httpStatus = 200;
      } else {
        status = RequestStatus.SUCCESS;
        httpStatus = 200;
      }
    } catch (e: any) {
      const normalized = this.normalizeError(e);
      errorCode = normalized.code;
      errorMessage = normalized.message;
      httpStatus = normalized.status;
      status = ctx.clientClosed ? RequestStatus.CANCELLED : RequestStatus.ERROR;
      if (ctx.intercept?.action === SensitiveAction.BLOCK) {
        status = RequestStatus.BLOCKED;
      }

      if (!ctx.clientClosed) {
        this.writeError(ctx, normalized);
      }
      if (normalized.status >= 500) {
        logger.warn(
          { requestId, code: normalized.code, err: normalized.original?.message },
          'gateway request failed',
        );
      }
    } finally {
      res.off('close', onClose);
      await this.rateLimit.releaseConcurrency(ctx.key?.id, (ctx as any).concurrencyAcquired);
      if (ctx.key) {
        await this.finishLog(ctx, status, httpStatus, errorCode, errorMessage);
      }
    }
  }

  private async processNonStream(ctx: GatewayContext) {
    const candidates = this.buildCandidates(ctx.model);
    if (!candidates.length) {
      throw new GatewayError('no_available_upstream', 'No available upstream for this model', 503, 'server_error');
    }

    let lastError: any;
    const maxAttempts = Math.min(candidates.length, 3);
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = candidates[i];
      const attempt: any = {
        providerId: candidate.provider.id,
        providerName: candidate.provider.name,
        upstreamModel: candidate.upstreamModel,
        status: 'pending',
        startedAt: Date.now(),
      };
      ctx.attempts.push(attempt);
      ctx.provider = candidate.provider;
      ctx.upstreamModel = candidate.upstreamModel;
      try {
        const fullProvider = await this.providers.getDecrypted(candidate.provider.id);
        const adapter = AdapterFactory.create(candidate.provider.type);
        const result = await adapter.chat({
          provider: { ...candidate.provider, ...fullProvider, apiKey: fullProvider.apiKey },
          apiKey: fullProvider.apiKey,
          upstreamModel: candidate.upstreamModel,
          body: ctx.body,
          signal: ctx.abortController.signal,
          timeoutMs: candidate.provider.timeoutMs || 120000,
        });
        attempt.status = 'success';
        attempt.latencyMs = Date.now() - attempt.startedAt;
        ctx.upstreamRequestId = result.upstreamRequestId;
        ctx.usage = result.usage || this.estimateUsage(ctx);
        ctx.responseBody = result.response;

        const outputItems = collectOutputTexts(result.response);
        const outputScan = this.sensitive.scanTexts(
          outputItems.map((item) => ({ path: JSON.stringify(item.path), text: item.text })),
          ctx.policyRules,
          'OUTPUT',
        );
        if (outputScan.action !== 'NONE' && outputScan.matches.length) {
          this.mergeIntercept(ctx, 'OUTPUT', outputScan.action as SensitiveAction, outputScan.matches);
          if (outputScan.action === SensitiveAction.MASK) {
            applyTextMasks(result.response, outputItems, outputScan.hits);
            ctx.sentText = collectOutputTexts(result.response)
              .map((i) => i.text)
              .join('\n');
          } else if (outputScan.action === SensitiveAction.BLOCK) {
            blockOutput(result.response);
            ctx.sentText = SAFE_OUTPUT;
          } else {
            ctx.sentText = outputItems.map((i) => i.text).join('\n');
          }
        } else {
          ctx.sentText = outputItems.map((i) => i.text).join('\n');
        }

        ctx.responseBytes = Buffer.byteLength(JSON.stringify(result.response), 'utf8');
        ctx.res.status(200).json(result.response);
        return;
      } catch (e: any) {
        attempt.status = 'error';
        attempt.error = e.message;
        attempt.latencyMs = Date.now() - attempt.startedAt;
        lastError = e;
        if (e instanceof UpstreamError && e.status === 499) throw e;
        const retryable = e instanceof UpstreamError ? e.retryable : false;
        if (!retryable || i >= maxAttempts - 1) throw e;
      }
    }
    throw lastError || new GatewayError('upstream_error', 'Upstream request failed', 502, 'server_error');
  }

  private async processStream(ctx: GatewayContext) {
    const candidates = this.buildCandidates(ctx.model);
    if (!candidates.length) {
      throw new GatewayError('no_available_upstream', 'No available upstream for this model', 503, 'server_error');
    }

    let lastError: any;
    const maxAttempts = Math.min(candidates.length, 3);
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = candidates[i];
      const attempt: any = {
        providerId: candidate.provider.id,
        providerName: candidate.provider.name,
        upstreamModel: candidate.upstreamModel,
        status: 'pending',
        startedAt: Date.now(),
      };
      ctx.attempts.push(attempt);
      ctx.provider = candidate.provider;
      ctx.upstreamModel = candidate.upstreamModel;

      let generator: AsyncGenerator<StreamEvent> | null = null;
      let first: IteratorResult<StreamEvent> | null = null;
      try {
        const fullProvider = await this.providers.getDecrypted(candidate.provider.id);
        const adapter = AdapterFactory.create(candidate.provider.type);
        const args: AdapterArgs = {
          provider: { ...candidate.provider, ...fullProvider, apiKey: fullProvider.apiKey },
          apiKey: fullProvider.apiKey,
          upstreamModel: candidate.upstreamModel,
          body: ctx.body,
          signal: ctx.abortController.signal,
          timeoutMs: candidate.provider.timeoutMs || 120000,
        };
        generator = adapter.chatStream(args);
        first = await generator.next();
        if (first.done) throw new UpstreamError('Upstream returned an empty stream', 502, true);
      } catch (e: any) {
        attempt.status = 'error';
        attempt.error = e.message;
        attempt.latencyMs = Date.now() - attempt.startedAt;
        lastError = e;
        if (e instanceof UpstreamError && e.status === 499) throw e;
        const retryable = e instanceof UpstreamError ? e.retryable : false;
        if (!retryable || i >= maxAttempts - 1) throw e;
        continue;
      }

      attempt.status = 'success';
      attempt.latencyMs = Date.now() - attempt.startedAt;
      ctx.res.status(200);
      ctx.res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      ctx.res.setHeader('cache-control', 'no-cache, no-transform');
      ctx.res.setHeader('connection', 'keep-alive');
      ctx.res.setHeader('x-accel-buffering', 'no');
      ctx.res.flushHeaders?.();

      const outputRules = ctx.policyRules.filter(
        (r) =>
          r.direction === SensitiveDirection.BOTH || r.direction === SensitiveDirection.OUTPUT,
      );
      const holdback = outputRules.length ? this.sensitive.getHoldback(outputRules) : 0;
      let textBuffer = '';
      let finishReason: string | null = 'stop';
      let usage: Usage | undefined;
      let blocked = false;

      this.writeSse(ctx, openAiChunk({ id: this.completionId(ctx), model: ctx.model.name, delta: { role: 'assistant' } }));

      try {
        const handle = (event: StreamEvent) => {
          if (event.usage) usage = event.usage;
          if (event.upstreamRequestId) ctx.upstreamRequestId = event.upstreamRequestId;
          if (event.finishReason) finishReason = event.finishReason;

          if (event.text) {
            textBuffer += event.text;
            const scan = this.sensitive.scanTexts(
              [{ path: 'output', text: textBuffer }],
              outputRules,
              'OUTPUT',
            );
            if (scan.action !== 'NONE' && scan.matches.length) {
              this.mergeIntercept(ctx, 'OUTPUT', scan.action as SensitiveAction, scan.matches);
              if (scan.action === SensitiveAction.BLOCK) {
                blocked = true;
                ctx.abortController.abort();
                return;
              }
              if (scan.action === SensitiveAction.MASK) {
                textBuffer = applyMaskLocal(textBuffer, scan.matches);
              }
            }
            if (holdback > 0) {
              const emitLength = Math.max(0, textBuffer.length - holdback);
              if (emitLength > 0) {
                const out = textBuffer.slice(0, emitLength);
                textBuffer = textBuffer.slice(emitLength);
                this.writeContent(ctx, out);
              }
            } else {
              this.writeContent(ctx, textBuffer);
              textBuffer = '';
            }
          } else if (event.chunk) {
            this.writeRaw(ctx, event.chunk);
          }
        };

        handle(first.value);
        while (!blocked && !ctx.clientClosed) {
          const next = await generator.next();
          if (next.done) break;
          handle(next.value);
        }
      } catch (e: any) {
        if (!ctx.clientClosed) {
          this.writeStreamError(ctx, 'upstream_stream_error', e.message || 'Upstream stream failed');
        }
        throw e;
      }

      if (blocked) {
        this.writeContent(ctx, SAFE_OUTPUT);
        ctx.usage = usage || this.estimateUsage(ctx);
        this.writeFinal(ctx, 'content_filter', ctx.usage);
        ctx.responseBody = { streamedText: ctx.sentText };
        return;
      }

      if (textBuffer) {
        this.writeContent(ctx, textBuffer);
        textBuffer = '';
      }
      ctx.usage = usage || this.estimateUsage(ctx);
      this.writeFinal(ctx, finishReason || 'stop', ctx.usage);
      ctx.responseBody = { streamedText: ctx.sentText };
      return;
    }

    throw lastError || new GatewayError('upstream_error', 'Upstream request failed', 502, 'server_error');
  }

  private writeContent(ctx: GatewayContext, text: string) {
    if (!text || ctx.clientClosed || ctx.res.writableEnded) return;
    if (!ctx.firstTokenAt) ctx.firstTokenAt = Date.now();
    ctx.sentText += text;
    this.writeSse(
      ctx,
      openAiChunk({
        id: this.completionId(ctx),
        model: ctx.model.name,
        delta: { content: text },
      }),
    );
  }

  private writeRaw(ctx: GatewayContext, chunk: any) {
    if (ctx.clientClosed || ctx.res.writableEnded) return;
    if (!chunk) return;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) return;
    const delta = choice?.delta || {};
    // Text content is handled by writeContent so the output guard can inspect it.
    if (!delta.tool_calls) return;
    this.writeSse(ctx, { ...chunk, model: ctx.model.name, id: this.completionId(ctx) });
  }

  private writeSse(ctx: GatewayContext, payload: any) {
    if (ctx.clientClosed || ctx.res.writableEnded) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    ctx.res.write(data);
    ctx.responseBytes += Buffer.byteLength(data);
  }

  private writeFinal(ctx: GatewayContext, finishReason: string, usage: Usage) {
    if (ctx.finalSent || ctx.clientClosed || ctx.res.writableEnded) return;
    ctx.finalSent = true;
    const id = this.completionId(ctx);
    const finalChunk = {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: ctx.model.name,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    };
    this.writeSse(ctx, finalChunk);

    if (ctx.body?.stream_options?.include_usage && usage) {
      this.writeSse(ctx, {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: ctx.model.name,
        choices: [],
        usage: {
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          total_tokens: usage.totalTokens,
        },
      });
    }

    if (!ctx.clientClosed && !ctx.res.writableEnded) {
      ctx.res.write('data: [DONE]\n\n');
      ctx.responseBytes += Buffer.byteLength('data: [DONE]\n\n');
      ctx.res.end();
    }
  }

  private writeStreamError(ctx: GatewayContext, code: string, message: string) {
    if (ctx.clientClosed || ctx.res.writableEnded || !ctx.res.headersSent) return;
    const payload = {
      error: {
        message,
        type: 'server_error',
        param: null,
        code,
      },
      request_id: ctx.requestId,
    };
    ctx.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    ctx.res.write('data: [DONE]\n\n');
    ctx.res.end();
  }

  private writeError(ctx: GatewayContext, error: { status: number; code: string; message: string; type: string; headers?: Record<string, string> }) {
    const { res } = ctx;
    if (error.headers) {
      for (const [k, v] of Object.entries(error.headers)) {
        if (!res.headersSent) res.setHeader(k, v);
      }
    }
    if (!res.headersSent) {
      res.status(error.status).json({
        error: {
          message: error.message,
          type: error.type,
          param: null,
          code: error.code,
        },
        request_id: ctx.requestId,
      });
      return;
    }
    if (!res.writableEnded) {
      if (ctx.stream) {
        this.writeStreamError(ctx, error.code, error.message);
      } else {
        res.end();
      }
    }
  }

  private buildCandidates(model: any) {
    const routes = (model?.routes || []).filter((r: any) => {
      const provider = r.providerModel?.provider;
      return (
        r.enabled &&
        r.providerModel?.enabled &&
        provider?.enabled &&
        provider?.health !== ProviderHealth.DOWN
      );
    });
    const groups = new Map<number, any[]>();
    for (const route of routes) {
      const priority = Number(route.priority || 10);
      if (!groups.has(priority)) groups.set(priority, []);
      groups.get(priority).push({
        provider: route.providerModel.provider,
        providerModel: route.providerModel,
        upstreamModel: route.providerModel.upstreamModel,
        priority,
        weight: Math.max(1, Number(route.weight || 100)),
      });
    }
    const result: any[] = [];
    for (const priority of [...groups.keys()].sort((a, b) => a - b)) {
      const group = [...groups.get(priority)];
      while (group.length) {
        const total = group.reduce((sum, c) => sum + c.weight, 0);
        let pick = Math.random() * total;
        let index = 0;
        for (let i = 0; i < group.length; i++) {
          pick -= group[i].weight;
          if (pick <= 0) {
            index = i;
            break;
          }
        }
        result.push(group.splice(index, 1)[0]);
      }
    }
    return result;
  }

  private assertKeyUsable(key: any) {
    if (key.status === KeyStatus.REVOKED) {
      throw new GatewayError('key_disabled', 'API key has been revoked', 403, 'permission_error');
    }
    if (key.status === KeyStatus.DISABLED) {
      throw new GatewayError('key_disabled', 'API key is disabled', 403, 'permission_error');
    }
    if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) {
      throw new GatewayError('key_expired', 'API key has expired', 401, 'authentication_error');
    }
  }

  private estimateUsage(ctx: GatewayContext): Usage {
    const prompt = collectInputTexts(ctx.body).reduce((sum, item) => sum + estimateTokens(item.text), 0);
    const completion = estimateTokens(ctx.sentText);
    ctx.usageEstimated = true;
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
    };
  }

  private mergeIntercept(
    ctx: GatewayContext,
    direction: 'INPUT' | 'OUTPUT',
    action: SensitiveAction,
    matches: SensitiveMatch[],
  ) {
    if (!matches.length) return;
    const rank: Record<string, number> = { LOG: 1, MASK: 2, BLOCK: 3 };
    if (!ctx.intercept) {
      ctx.intercept = { direction, action, matches: [...matches] };
      return;
    }
    ctx.intercept.matches.push(...matches);
    if (rank[action] > rank[ctx.intercept.action]) {
      ctx.intercept.action = action;
      ctx.intercept.direction = direction;
    }
  }

  private async finishLog(
    ctx: GatewayContext,
    status: RequestStatus,
    httpStatus: number,
    errorCode?: string,
    errorMessage?: string,
  ) {
    try {
      const latencyMs = Date.now() - ctx.startedAt;
      const hasProvider = Boolean(ctx.provider);
      const usage = hasProvider
        ? ctx.usage?.totalTokens
          ? ctx.usage
          : this.estimateUsage(ctx)
        : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const cost = calcCost(
        ctx.model?.inputPrice,
        ctx.model?.outputPrice,
        usage.promptTokens,
        usage.completionTokens,
      );
      const matches = ctx.intercept?.matches || [];
      const ruleIds = [...new Set(matches.map((m) => m.ruleId))];
      const summaryMap = new Map<string, { count: number; masked: string }>();
      for (const m of matches) {
        const existing = summaryMap.get(m.ruleName);
        if (existing) existing.count += 1;
        else summaryMap.set(m.ruleName, { count: 1, masked: m.masked });
      }
      const summary = [...summaryMap.entries()]
        .map(([name, v]) => `${name} ×${v.count}（${v.masked}）`)
        .join('；')
        .slice(0, 2000);

      const log = await this.logs.createLog({
        requestId: ctx.requestId,
        keyId: ctx.key.id,
        keyName: ctx.key.name,
        modelRequested: ctx.model?.name || ctx.body?.model || 'unknown',
        providerId: ctx.provider?.id,
        providerName: ctx.provider?.name,
        upstreamModel: ctx.upstreamModel,
        endpoint: ctx.endpoint,
        stream: ctx.stream,
        status,
        httpStatus,
        errorCode,
        errorMessage: errorMessage?.slice(0, 4000),
        latencyMs,
        ttftMs: ctx.firstTokenAt ? ctx.firstTokenAt - ctx.startedAt : null,
        inputTokens: usage.promptTokens || null,
        outputTokens: usage.completionTokens || null,
        totalTokens: usage.totalTokens || null,
        usageEstimated: ctx.usageEstimated,
        costEstimate: new Prisma.Decimal(cost.toFixed(8)),
        clientIp: ctx.req.ip,
        userAgent: String(ctx.req.headers['user-agent'] || '').slice(0, 2000),
        requestBytes: Buffer.byteLength(JSON.stringify(ctx.body || {}), 'utf8'),
        responseBytes: ctx.responseBytes || null,
        retryCount: Math.max(0, ctx.attempts.length - 1),
        attempts: sanitizeForAudit(ctx.attempts),
        intercepted: Boolean(ctx.intercept),
        interceptDirection: ctx.intercept?.direction as InterceptDirection | undefined,
        interceptAction: ctx.intercept?.action,
        interceptRuleIds: ruleIds,
        interceptSummary: summary || null,
        upstreamRequestId: ctx.upstreamRequestId,
        traceId: ctx.requestId,
        source: ctx.source,
      });

      if (log && ctx.key.logBody) {
        const requestForLog = ctx.intercept
          ? {
              redacted: true,
              reason: 'sensitive content detected',
              direction: ctx.intercept.direction,
              action: ctx.intercept.action,
            }
          : sanitizeForAudit(ctx.body);
        const responseForLog =
          ctx.intercept?.action === SensitiveAction.BLOCK
            ? { redacted: true, blocked: true, reason: 'output blocked by sensitive policy' }
            : ctx.responseBody || (ctx.sentText ? { text: ctx.sentText } : null);
        await this.logs.createBody(log.id, requestForLog, responseForLog);
      }

      const chargeable =
        hasProvider &&
        (status === RequestStatus.SUCCESS ||
          (status === RequestStatus.BLOCKED && ctx.intercept?.direction === 'OUTPUT'));
      if (chargeable && usage.totalTokens > 0) {
        await this.keys.addUsage(ctx.key.id, usage.totalTokens, cost).catch(() => undefined);
      }
      await this.keys.touch(ctx.key.id).catch(() => undefined);
    } catch (e: any) {
      logger.warn({ err: e.message, requestId: ctx.requestId }, 'failed to finalize request log');
    }
  }

  private completionId(ctx: GatewayContext) {
    return `chatcmpl-${ctx.requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`;
  }

  private normalizeError(e: any): {
    status: number;
    code: string;
    message: string;
    type: string;
    headers?: Record<string, string>;
    original?: any;
  } {
    if (e instanceof GatewayError) {
      return {
        status: e.getStatus(),
        code: e.code,
        message: e.message,
        type: e.type,
        headers: e.headers,
        original: e,
      };
    }
    if (e instanceof UpstreamError) {
      return {
        status: e.status === 499 ? 499 : e.status >= 500 ? e.status : 502,
        code: e.status === 504 ? 'upstream_timeout' : 'upstream_error',
        message: e.message,
        type: 'server_error',
        original: e,
      };
    }
    if (e?.getStatus) {
      return {
        status: e.getStatus(),
        code: e.code || 'request_error',
        message: e.message,
        type: 'invalid_request_error',
        original: e,
      };
    }
    return {
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
      type: 'server_error',
      original: e,
    };
  }
}
