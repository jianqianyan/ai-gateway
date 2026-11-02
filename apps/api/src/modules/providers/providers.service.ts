import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderHealth, ProviderType } from '@prisma/client';
import ipaddr from 'ipaddr.js';
import { PrismaService } from '../../core/prisma.service';
import { EncryptionService } from '../../core/encryption.service';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';
import {
  CreateProviderDto,
  CreateProviderModelDto,
  TestProviderDto,
  UpdateProviderDto,
  UpdateProviderModelDto,
} from './dto';

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
  ) {}

  async list() {
    const providers = await this.prisma.provider.findMany({
      include: { _count: { select: { models: true } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return providers.map((p) => this.safe(p));
  }

  async findOne(id: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id },
      include: { models: { orderBy: { upstreamModel: 'asc' } } },
    });
    if (!provider) throw new AppError('provider_not_found', 'Provider not found', 404);
    return {
      ...this.safe(provider),
      models: provider.models.map((m) => this.safeModel(m)),
    };
  }

  async create(dto: CreateProviderDto) {
    this.validateBaseUrl(dto.baseUrl);
    const encrypted = dto.apiKey ? this.encryption.encrypt(dto.apiKey) : null;
    const provider = await this.prisma.provider.create({
      data: {
        name: dto.name,
        type: dto.type,
        baseUrl: dto.baseUrl.replace(/\/+$/, ''),
        apiKeyCipher: encrypted?.cipher,
        apiKeyIv: encrypted?.iv,
        apiKeyTag: encrypted?.tag,
        headers: dto.headers as any,
        timeoutMs: dto.timeoutMs ?? 120000,
        maxRetries: dto.maxRetries ?? 1,
        priority: dto.priority ?? 10,
        weight: dto.weight ?? 100,
        enabled: dto.enabled ?? true,
      },
    });
    return this.safe(provider);
  }

  async update(id: string, dto: UpdateProviderDto) {
    const existing = await this.prisma.provider.findUnique({ where: { id } });
    if (!existing) throw new AppError('provider_not_found', 'Provider not found', 404);
    if (dto.baseUrl) this.validateBaseUrl(dto.baseUrl);

    const data: any = { ...dto };
    delete data.apiKey;
    if (dto.baseUrl) data.baseUrl = dto.baseUrl.replace(/\/+$/, '');
    if (dto.headers !== undefined) data.headers = dto.headers;
    if (dto.apiKey) {
      const encrypted = this.encryption.encrypt(dto.apiKey);
      data.apiKeyCipher = encrypted.cipher;
      data.apiKeyIv = encrypted.iv;
      data.apiKeyTag = encrypted.tag;
    }
    const provider = await this.prisma.provider.update({ where: { id }, data });
    return this.safe(provider);
  }

  async remove(id: string) {
    const exists = await this.prisma.provider.findUnique({ where: { id } });
    if (!exists) throw new AppError('provider_not_found', 'Provider not found', 404);
    await this.prisma.provider.delete({ where: { id } });
    return { success: true };
  }

  async getDecrypted(id: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id },
      include: { models: true },
    });
    if (!provider) throw new AppError('provider_not_found', 'Provider not found', 404);
    return {
      ...provider,
      apiKey: this.encryption.decrypt(
        provider.apiKeyCipher,
        provider.apiKeyIv,
        provider.apiKeyTag,
      ),
    };
  }

  async test(id: string, dto: TestProviderDto) {
    const provider = await this.getDecrypted(id);
    const started = Date.now();
    try {
      let message = '连接成功';
      if (provider.type === ProviderType.OPENAI || provider.type === ProviderType.AZURE_OPENAI) {
        const res = await fetch(joinUrl(provider.baseUrl, 'models'), {
          headers: this.buildHeaders(provider, provider.apiKey),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data: any = await res.json();
        message = `连接成功，发现 ${Array.isArray(data?.data) ? data.data.length : 0} 个模型`;
      } else if (provider.type === ProviderType.GEMINI) {
        const url = `${joinUrl(provider.baseUrl, 'models')}?key=${encodeURIComponent(provider.apiKey)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data: any = await res.json();
        message = `连接成功，发现 ${Array.isArray(data?.models) ? data.models.length : 0} 个模型`;
      } else if (provider.type === ProviderType.ANTHROPIC) {
        const model = dto.model || provider.models[0]?.upstreamModel;
        if (!model) {
          throw new Error('Anthropic 没有模型列表接口，请先手工添加上游模型后再测试');
        }
        const res = await fetch(joinUrl(provider.baseUrl, 'messages'), {
          method: 'POST',
          headers: {
            ...this.buildHeaders(provider, provider.apiKey),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        message = '连接成功（Anthropic Messages 接口）';
      }

      await this.updateHealth(id, ProviderHealth.HEALTHY, null);
      return { ok: true, message, latencyMs: Date.now() - started };
    } catch (e: any) {
      await this.updateHealth(id, ProviderHealth.DOWN, e.message);
      return { ok: false, message: e.message, latencyMs: Date.now() - started };
    }
  }

  async syncModels(id: string) {
    const provider = await this.getDecrypted(id);
    let models: { id: string; displayName?: string }[] = [];
    let message = '';

    if (provider.type === ProviderType.OPENAI || provider.type === ProviderType.AZURE_OPENAI) {
      const res = await fetch(joinUrl(provider.baseUrl, 'models'), {
        headers: this.buildHeaders(provider, provider.apiKey),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new AppError('sync_failed', `上游返回 HTTP ${res.status}`, 502);
      const data: any = await res.json();
      models = (data?.data || []).map((m: any) => ({ id: m.id, displayName: m.id }));
    } else if (provider.type === ProviderType.GEMINI) {
      const url = `${joinUrl(provider.baseUrl, 'models')}?key=${encodeURIComponent(provider.apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new AppError('sync_failed', `上游返回 HTTP ${res.status}`, 502);
      const data: any = await res.json();
      models = (data?.models || []).map((m: any) => ({
        id: String(m.name || '').replace(/^models\//, ''),
        displayName: m.displayName,
      }));
    } else {
      message = 'Anthropic 不提供模型列表接口，请手工添加上游模型';
    }

    for (const model of models.filter((m) => m.id)) {
      await this.prisma.providerModel.upsert({
        where: {
          providerId_upstreamModel: { providerId: id, upstreamModel: model.id },
        },
        create: {
          providerId: id,
          upstreamModel: model.id,
          displayName: model.displayName,
        },
        update: {},
      });
    }
    await this.updateHealth(id, ProviderHealth.HEALTHY, null);
    return {
      success: true,
      count: models.length,
      message: message || `同步完成，共 ${models.length} 个模型`,
    };
  }

  async listAllModels() {
    const models = await this.prisma.providerModel.findMany({
      include: {
        provider: { select: { id: true, name: true, type: true, enabled: true, health: true } },
      },
      orderBy: [{ provider: { name: 'asc' } }, { upstreamModel: 'asc' }],
    });
    return models.map((m) => ({
      ...this.safeModel(m),
      provider: m.provider,
    }));
  }

  async addModel(providerId: string, dto: CreateProviderModelDto) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new AppError('provider_not_found', 'Provider not found', 404);
    const model = await this.prisma.providerModel.upsert({
      where: {
        providerId_upstreamModel: { providerId, upstreamModel: dto.upstreamModel },
      },
      create: {
        providerId,
        upstreamModel: dto.upstreamModel,
        displayName: dto.displayName || dto.upstreamModel,
        capabilities: (dto.capabilities || ['chat']) as any,
        contextWindow: dto.contextWindow,
        enabled: dto.enabled ?? true,
      },
      update: {
        displayName: dto.displayName,
        capabilities: dto.capabilities as any,
        contextWindow: dto.contextWindow,
        enabled: dto.enabled,
      },
    });
    return this.safeModel(model);
  }

  async updateModel(providerId: string, modelId: string, dto: UpdateProviderModelDto) {
    const model = await this.prisma.providerModel.findFirst({
      where: { id: modelId, providerId },
    });
    if (!model) throw new AppError('provider_model_not_found', 'Provider model not found', 404);
    const updated = await this.prisma.providerModel.update({
      where: { id: modelId },
      data: {
        displayName: dto.displayName,
        capabilities: dto.capabilities as any,
        contextWindow: dto.contextWindow,
        enabled: dto.enabled,
      },
    });
    return this.safeModel(updated);
  }

  async removeModel(providerId: string, modelId: string) {
    const model = await this.prisma.providerModel.findFirst({
      where: { id: modelId, providerId },
    });
    if (!model) throw new AppError('provider_model_not_found', 'Provider model not found', 404);
    await this.prisma.providerModel.delete({ where: { id: modelId } });
    return { success: true };
  }

  async updateHealth(id: string, health: ProviderHealth, error: string | null) {
    await this.prisma.provider.update({
      where: { id },
      data: { health, lastCheckedAt: new Date(), lastError: error },
    });
  }

  buildHeaders(provider: any, apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...(provider.headers && typeof provider.headers === 'object' ? provider.headers : {}),
    };
    if (provider.type === ProviderType.OPENAI) {
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    } else if (provider.type === ProviderType.ANTHROPIC) {
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01';
    } else if (provider.type === ProviderType.AZURE_OPENAI) {
      if (apiKey) headers['api-key'] = apiKey;
    }
    return headers;
  }

  private validateBaseUrl(raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AppError('invalid_base_url', 'Base URL is invalid', 400);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError('invalid_base_url', 'Base URL must use http or https', 400);
    }
    const allowPrivate = String(this.config.get('ALLOW_PRIVATE_UPSTREAMS') || 'false') === 'true';
    if (allowPrivate) return;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254', 'metadata.google.internal'].includes(host)) {
      throw new AppError('private_upstream_blocked', 'Private upstream addresses are blocked', 400);
    }
    try {
      const ip = ipaddr.parse(host);
      const range = ip.range();
      if (['private', 'loopback', 'linkLocal', 'uniqueLocal', 'unspecified'].includes(range)) {
        throw new AppError('private_upstream_blocked', 'Private upstream addresses are blocked', 400);
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      // hostname is not a literal IP; allow it
    }
  }

  private safe(provider: any) {
    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      hasApiKey: Boolean(provider.apiKeyCipher),
      apiKeyMasked: provider.apiKeyCipher ? '••••••••' : '',
      headers: provider.headers || {},
      timeoutMs: provider.timeoutMs,
      maxRetries: provider.maxRetries,
      priority: provider.priority,
      weight: provider.weight,
      enabled: provider.enabled,
      health: provider.health,
      lastCheckedAt: provider.lastCheckedAt,
      lastError: provider.lastError,
      modelCount: provider._count?.models,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }

  private safeModel(model: any) {
    return {
      id: model.id,
      providerId: model.providerId,
      upstreamModel: model.upstreamModel,
      displayName: model.displayName,
      capabilities: model.capabilities || [],
      contextWindow: model.contextWindow,
      enabled: model.enabled,
      discoveredAt: model.discoveredAt,
    };
  }
}
