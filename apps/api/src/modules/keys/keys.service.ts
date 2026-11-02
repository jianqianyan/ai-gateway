import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeyStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../core/prisma.service';
import { EncryptionService } from '../../core/encryption.service';
import { AppError } from '../../common/errors';
import { isValidIpEntry } from '../../common/utils/ip';
import { CreateKeyDto, UpdateKeyDto } from './dto';

@Injectable()
export class KeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
  ) {}

  async list() {
    const keys = await this.prisma.apiKey.findMany({
      include: {
        keyModels: { include: { model: { select: { id: true, name: true, displayName: true } } } },
        sensitivePolicy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => this.safe(k));
  }

  async findOne(id: string) {
    const key = await this.prisma.apiKey.findUnique({
      where: { id },
      include: {
        keyModels: { include: { model: { select: { id: true, name: true, displayName: true } } } },
        sensitivePolicy: { select: { id: true, name: true } },
      },
    });
    if (!key) throw new AppError('key_not_found', 'API key not found', 404);
    return this.safe(key);
  }

  async create(dto: CreateKeyDto, createdById?: string) {
    await this.validateModels(dto.modelIds);
    await this.validatePolicy(dto.sensitivePolicyId);
    const secret = this.generateSecret();
    const key = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        keyPrefix: secret.slice(0, 12),
        keyHash: this.encryption.sha256(secret),
        last4: secret.slice(-4),
        owner: dto.owner,
        note: dto.note,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        ipAllowlist: this.normalizeIps(dto.ipAllowlist) as any,
        rpmLimit: dto.rpmLimit,
        tpmLimit: dto.tpmLimit,
        concurrencyLimit: dto.concurrencyLimit,
        dailyRequestLimit: dto.dailyRequestLimit,
        quotaRequests: dto.quotaRequests ? BigInt(Math.floor(dto.quotaRequests)) : null,
        quotaTokens: dto.quotaTokens ? BigInt(Math.floor(dto.quotaTokens)) : null,
        quotaCost: dto.quotaCost ?? null,
        monthlyTokenLimit: dto.monthlyTokenLimit ? BigInt(Math.floor(dto.monthlyTokenLimit)) : null,
        monthlyCostLimit: dto.monthlyCostLimit ?? null,
        sensitivePolicyId: dto.sensitivePolicyId || null,
        logBody: dto.logBody ?? false,
        createdById,
        keyModels: { create: dto.modelIds.map((modelId) => ({ modelId })) },
      } as any,
      include: {
        keyModels: { include: { model: { select: { id: true, name: true, displayName: true } } } },
        sensitivePolicy: { select: { id: true, name: true } },
      },
    });
    return { ...this.safe(key), secret };
  }

  async update(id: string, dto: UpdateKeyDto) {
    const exists = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!exists) throw new AppError('key_not_found', 'API key not found', 404);
    if (dto.modelIds) await this.validateModels(dto.modelIds);
    if (dto.sensitivePolicyId) await this.validatePolicy(dto.sensitivePolicyId);

    const data: any = {
      name: dto.name,
      owner: dto.owner,
      note: dto.note,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      ipAllowlist: dto.ipAllowlist ? this.normalizeIps(dto.ipAllowlist) : undefined,
      rpmLimit: dto.rpmLimit,
      tpmLimit: dto.tpmLimit,
      concurrencyLimit: dto.concurrencyLimit,
      dailyRequestLimit: dto.dailyRequestLimit,
      quotaRequests: dto.quotaRequests !== undefined ? BigInt(Math.floor(dto.quotaRequests)) : undefined,
      quotaTokens: dto.quotaTokens !== undefined ? BigInt(Math.floor(dto.quotaTokens)) : undefined,
      quotaCost: dto.quotaCost,
      monthlyTokenLimit:
        dto.monthlyTokenLimit !== undefined ? BigInt(Math.floor(dto.monthlyTokenLimit)) : undefined,
      monthlyCostLimit: dto.monthlyCostLimit,
      sensitivePolicyId: dto.sensitivePolicyId === '' ? null : dto.sensitivePolicyId,
      logBody: dto.logBody,
    };

    const key = await this.prisma.$transaction(async (tx) => {
      if (dto.modelIds) {
        await tx.apiKeyModel.deleteMany({ where: { apiKeyId: id } });
        await tx.apiKeyModel.createMany({
          data: dto.modelIds.map((modelId) => ({ apiKeyId: id, modelId })),
          skipDuplicates: true,
        });
      }
      return tx.apiKey.update({
        where: { id },
        data,
        include: {
          keyModels: { include: { model: { select: { id: true, name: true, displayName: true } } } },
          sensitivePolicy: { select: { id: true, name: true } },
        },
      });
    });
    return this.safe(key);
  }

  async rotate(id: string) {
    const exists = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!exists) throw new AppError('key_not_found', 'API key not found', 404);
    const secret = this.generateSecret();
    const key = await this.prisma.apiKey.update({
      where: { id },
      data: {
        keyPrefix: secret.slice(0, 12),
        keyHash: this.encryption.sha256(secret),
        last4: secret.slice(-4),
        status: KeyStatus.ACTIVE,
        revokedAt: null,
      },
    });
    return { ...this.safe(key), secret };
  }

  async revoke(id: string) {
    return this.setStatus(id, KeyStatus.REVOKED, true);
  }

  async disable(id: string) {
    return this.setStatus(id, KeyStatus.DISABLED);
  }

  async enable(id: string) {
    return this.setStatus(id, KeyStatus.ACTIVE);
  }

  async remove(id: string) {
    const exists = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!exists) throw new AppError('key_not_found', 'API key not found', 404);
    await this.prisma.apiKey.delete({ where: { id } });
    return { success: true };
  }

  async getById(id: string) {
    return this.prisma.apiKey.findUnique({
      where: { id },
      include: {
        keyModels: { include: { model: true } },
        sensitivePolicy: true,
      },
    });
  }

  async findBySecret(secret: string) {
    if (!secret || !secret.startsWith('sk-gw-')) return null;
    const hash = this.encryption.sha256(secret);
    return this.prisma.apiKey.findUnique({
      where: { keyHash: hash },
      include: {
        keyModels: { include: { model: true } },
        sensitivePolicy: true,
      },
    });
  }

  async checkQuota(key: any) {
    if (key.quotaTokens !== null && key.quotaTokens !== undefined && key.usedTokens >= key.quotaTokens) {
      return { ok: false, reason: '总 Token 配额已用完' };
    }
    if (key.quotaCost !== null && key.quotaCost !== undefined && Number(key.usedCost) >= Number(key.quotaCost)) {
      return { ok: false, reason: '总成本配额已用完' };
    }

    if (
      (key.monthlyTokenLimit !== null && key.monthlyTokenLimit !== undefined) ||
      (key.monthlyCostLimit !== null && key.monthlyCostLimit !== undefined)
    ) {
      const start = this.monthStart();
      const rows: any[] = await this.prisma.$queryRaw`
        SELECT COALESCE(SUM(totalTokens), 0) AS tokens, COALESCE(SUM(costEstimate), 0) AS cost
        FROM \`RequestLog\`
        WHERE keyId = ${key.id} AND createdAt >= ${start}
      `;
      const tokens = Number(rows[0]?.tokens || 0);
      const cost = Number(rows[0]?.cost || 0);
      if (key.monthlyTokenLimit !== null && key.monthlyTokenLimit !== undefined && tokens >= Number(key.monthlyTokenLimit)) {
        return { ok: false, reason: '本月 Token 配额已用完' };
      }
      if (key.monthlyCostLimit !== null && key.monthlyCostLimit !== undefined && cost >= Number(key.monthlyCostLimit)) {
        return { ok: false, reason: '本月成本配额已用完' };
      }
    }
    return { ok: true };
  }

  async consumeRequest(keyId: string): Promise<boolean> {
    const affected = await this.prisma.$executeRaw`
      UPDATE \`ApiKey\`
      SET usedRequests = usedRequests + 1
      WHERE id = ${keyId}
        AND (quotaRequests IS NULL OR usedRequests + 1 <= quotaRequests)
    `;
    return affected > 0;
  }

  async addUsage(keyId: string, tokens: number, cost: number) {
    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: {
        usedTokens: { increment: BigInt(Math.max(0, Math.floor(tokens))) },
        usedCost: { increment: new Prisma.Decimal(cost.toFixed(8)) },
        lastUsedAt: new Date(),
      },
    });
  }

  async touch(keyId: string) {
    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date() },
    });
  }

  async usage(id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new AppError('key_not_found', 'API key not found', 404);
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT
        COUNT(*) AS requests,
        COALESCE(SUM(totalTokens), 0) AS tokens,
        COALESCE(SUM(costEstimate), 0) AS cost,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END), 0) AS success,
        COALESCE(SUM(CASE WHEN intercepted = 1 THEN 1 ELSE 0 END), 0) AS intercepted
      FROM \`RequestLog\`
      WHERE keyId = ${id} AND createdAt >= ${since}
    `;
    return {
      key: this.safe(key),
      last30Days: {
        requests: Number(rows[0]?.requests || 0),
        tokens: Number(rows[0]?.tokens || 0),
        cost: Number(rows[0]?.cost || 0),
        success: Number(rows[0]?.success || 0),
        intercepted: Number(rows[0]?.intercepted || 0),
      },
    };
  }

  private async setStatus(id: string, status: KeyStatus, revoked = false) {
    const exists = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!exists) throw new AppError('key_not_found', 'API key not found', 404);
    const key = await this.prisma.apiKey.update({
      where: { id },
      data: { status, revokedAt: revoked ? new Date() : null },
    });
    return this.safe(key);
  }

  private generateSecret() {
    return `sk-gw-${randomBytes(32).toString('base64url')}`;
  }

  private normalizeIps(list?: string[]) {
    const cleaned = (list || []).map((s) => s.trim()).filter(Boolean);
    for (const entry of cleaned) {
      if (!isValidIpEntry(entry)) {
        throw new AppError('invalid_ip_allowlist', `Invalid IP or CIDR: ${entry}`, 400);
      }
    }
    return cleaned;
  }

  private async validateModels(modelIds: string[]) {
    const unique = [...new Set(modelIds || [])];
    if (unique.length === 0) return;
    const count = await this.prisma.model.count({ where: { id: { in: unique } } });
    if (count !== unique.length) {
      throw new AppError('model_not_found', 'One or more models do not exist', 400);
    }
  }

  private async validatePolicy(policyId?: string) {
    if (!policyId) return;
    const count = await this.prisma.sensitivePolicy.count({ where: { id: policyId } });
    if (!count) throw new AppError('policy_not_found', 'Sensitive policy not found', 400);
  }

  private monthStart() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private safe(key: any) {
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      maskedKey: `${key.keyPrefix}...${key.last4}`,
      owner: key.owner,
      note: key.note,
      status: key.status,
      expiresAt: key.expiresAt,
      quotaRequests: key.quotaRequests === null ? null : Number(key.quotaRequests),
      quotaTokens: key.quotaTokens === null ? null : Number(key.quotaTokens),
      quotaCost: key.quotaCost === null ? null : Number(key.quotaCost),
      usedRequests: Number(key.usedRequests),
      usedTokens: Number(key.usedTokens),
      usedCost: Number(key.usedCost),
      rpmLimit: key.rpmLimit,
      tpmLimit: key.tpmLimit,
      concurrencyLimit: key.concurrencyLimit,
      dailyRequestLimit: key.dailyRequestLimit,
      monthlyTokenLimit: key.monthlyTokenLimit === null ? null : Number(key.monthlyTokenLimit),
      monthlyCostLimit: key.monthlyCostLimit === null ? null : Number(key.monthlyCostLimit),
      ipAllowlist: Array.isArray(key.ipAllowlist) ? key.ipAllowlist : [],
      sensitivePolicyId: key.sensitivePolicyId,
      sensitivePolicy: key.sensitivePolicy
        ? { id: key.sensitivePolicy.id, name: key.sensitivePolicy.name }
        : null,
      logBody: key.logBody,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      models: (key.keyModels || []).map((km: any) => ({
        id: km.model.id,
        name: km.model.name,
        displayName: km.model.displayName,
      })),
    };
  }
}
