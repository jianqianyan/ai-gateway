import { Injectable } from '@nestjs/common';
import {
  SensitiveAction,
  SensitiveDirection,
  SensitiveRuleType,
} from '@prisma/client';
import safeRegex from 'safe-regex2';
import { PrismaService } from '../../core/prisma.service';
import { AppError } from '../../common/errors';
import { RuleLike, applyMask, maxHoldback, scanText, scanTexts } from './matcher';
import {
  CreateSensitivePolicyDto,
  CreateSensitiveRuleDto,
  TestSensitiveDto,
  UpdateSensitivePolicyDto,
  UpdateSensitiveRuleDto,
} from './dto';

@Injectable()
export class SensitiveService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules() {
    const rules = await this.prisma.sensitiveRule.findMany({
      include: { _count: { select: { policies: true } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return rules.map((r) => this.safeRule(r));
  }

  async createRule(dto: CreateSensitiveRuleDto) {
    const pattern = dto.pattern?.trim();
    if (dto.type !== SensitiveRuleType.BUILTIN) {
      if (!pattern) throw new AppError('pattern_required', 'Pattern is required', 400);
      this.validatePattern(dto.type, pattern);
    }
    const rule = await this.prisma.sensitiveRule.create({
      data: {
        name: dto.name,
        category: dto.category || '自定义',
        type: dto.type,
        pattern,
        action: dto.action || SensitiveAction.BLOCK,
        direction: dto.direction || SensitiveDirection.BOTH,
        severity: dto.severity ?? 50,
        priority: dto.priority ?? 10,
        replacement: dto.replacement || '***',
        enabled: dto.enabled ?? true,
      },
    });
    const defaultPolicy = await this.prisma.sensitivePolicy.findFirst({ where: { isDefault: true } });
    if (defaultPolicy) {
      await this.prisma.sensitivePolicyRule.createMany({
        data: [{ policyId: defaultPolicy.id, ruleId: rule.id }],
        skipDuplicates: true,
      });
    }
    return this.safeRule(rule);
  }

  async updateRule(id: string, dto: UpdateSensitiveRuleDto) {
    const existing = await this.prisma.sensitiveRule.findUnique({ where: { id } });
    if (!existing) throw new AppError('rule_not_found', 'Sensitive rule not found', 404);
    if (dto.pattern !== undefined) {
      if (existing.isBuiltin) {
        throw new AppError('builtin_rule_immutable', 'Built-in rule patterns cannot be changed', 400);
      }
      this.validatePattern(existing.type, dto.pattern);
    }
    const rule = await this.prisma.sensitiveRule.update({
      where: { id },
      data: {
        name: dto.name,
        category: dto.category,
        action: dto.action,
        direction: dto.direction,
        severity: dto.severity,
        priority: dto.priority,
        replacement: dto.replacement,
        enabled: dto.enabled,
        pattern: dto.pattern,
      },
    });
    return this.safeRule(rule);
  }

  async deleteRule(id: string) {
    const rule = await this.prisma.sensitiveRule.findUnique({ where: { id } });
    if (!rule) throw new AppError('rule_not_found', 'Sensitive rule not found', 404);
    if (rule.isBuiltin) {
      throw new AppError('builtin_rule_immutable', 'Built-in rules can be disabled but not deleted', 400);
    }
    await this.prisma.sensitiveRule.delete({ where: { id } });
    return { success: true };
  }

  async listPolicies() {
    const policies = await this.prisma.sensitivePolicy.findMany({
      include: { _count: { select: { rules: true, keys: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return policies.map((p) => this.safePolicy(p));
  }

  async getPolicy(id: string) {
    const policy = await this.prisma.sensitivePolicy.findUnique({
      where: { id },
      include: { rules: { include: { rule: true } } },
    });
    if (!policy) throw new AppError('policy_not_found', 'Sensitive policy not found', 404);
    return {
      ...this.safePolicy(policy),
      rules: policy.rules.map((r) => this.safeRule(r.rule)),
    };
  }

  async createPolicy(dto: CreateSensitivePolicyDto) {
    if (dto.isDefault) {
      await this.prisma.sensitivePolicy.updateMany({ data: { isDefault: false } });
    }
    const policy = await this.prisma.sensitivePolicy.create({
      data: {
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        rules: dto.ruleIds?.length
          ? { create: dto.ruleIds.map((ruleId) => ({ ruleId })) }
          : undefined,
      },
      include: { _count: { select: { rules: true, keys: true } } },
    });
    return this.safePolicy(policy);
  }

  async updatePolicy(id: string, dto: UpdateSensitivePolicyDto) {
    const existing = await this.prisma.sensitivePolicy.findUnique({ where: { id } });
    if (!existing) throw new AppError('policy_not_found', 'Sensitive policy not found', 404);
    if (dto.isDefault) {
      await this.prisma.sensitivePolicy.updateMany({ data: { isDefault: false } });
    }
    const policy = await this.prisma.$transaction(async (tx) => {
      if (dto.ruleIds) {
        await tx.sensitivePolicyRule.deleteMany({ where: { policyId: id } });
        if (dto.ruleIds.length) {
          await tx.sensitivePolicyRule.createMany({
            data: dto.ruleIds.map((ruleId) => ({ policyId: id, ruleId })),
            skipDuplicates: true,
          });
        }
      }
      return tx.sensitivePolicy.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          isDefault: dto.isDefault,
        },
        include: { _count: { select: { rules: true, keys: true } } },
      });
    });
    return this.safePolicy(policy);
  }

  async setDefaultPolicy(id: string) {
    const existing = await this.prisma.sensitivePolicy.findUnique({ where: { id } });
    if (!existing) throw new AppError('policy_not_found', 'Sensitive policy not found', 404);
    await this.prisma.$transaction([
      this.prisma.sensitivePolicy.updateMany({ data: { isDefault: false } }),
      this.prisma.sensitivePolicy.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { success: true };
  }

  async deletePolicy(id: string) {
    const existing = await this.prisma.sensitivePolicy.findUnique({ where: { id } });
    if (!existing) throw new AppError('policy_not_found', 'Sensitive policy not found', 404);
    if (existing.isDefault) {
      throw new AppError('default_policy', 'The default policy cannot be deleted', 400);
    }
    await this.prisma.sensitivePolicy.delete({ where: { id } });
    return { success: true };
  }

  async getRulesForPolicy(policyId?: string | null): Promise<RuleLike[]> {
    let id = policyId;
    if (!id) {
      const def = await this.prisma.sensitivePolicy.findFirst({ where: { isDefault: true } });
      id = def?.id;
    }
    if (id) {
      const links = await this.prisma.sensitivePolicyRule.findMany({
        where: { policyId: id },
        include: { rule: true },
      });
      return links.map((l) => l.rule as unknown as RuleLike).filter((r) => r.enabled);
    }
    return (await this.prisma.sensitiveRule.findMany({ where: { enabled: true } })) as unknown as RuleLike[];
  }

  async getRulesForKey(key: any): Promise<RuleLike[]> {
    return this.getRulesForPolicy(key?.sensitivePolicyId);
  }

  async test(dto: TestSensitiveDto) {
    const rules = await this.getRulesForPolicy(dto.policyId);
    const direction = dto.direction || SensitiveDirection.BOTH;
    const started = Date.now();
    if (direction === SensitiveDirection.BOTH) {
      const input = scanText(dto.text, rules, 'INPUT');
      const output = scanText(dto.text, rules, 'OUTPUT');
      const seen = new Set<string>();
      const matches = [...input.matches, ...output.matches]
        .filter((m) => {
          const key = `${m.ruleId}:${m.start}:${m.end}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.start - b.start);
      return {
        action: this.highest(input.action, output.action),
        matches,
        elapsedMs: Date.now() - started,
        ruleCount: rules.length,
      };
    }
    const result = scanText(dto.text, rules, direction);
    return { ...result, elapsedMs: Date.now() - started, ruleCount: rules.length };
  }

  scanText(text: string, rules: RuleLike[], direction: 'INPUT' | 'OUTPUT') {
    return scanText(text, rules, direction);
  }

  scanTexts(texts: { path: string; text: string }[], rules: RuleLike[], direction: 'INPUT' | 'OUTPUT') {
    return scanTexts(texts, rules, direction);
  }

  applyMask(text: string, matches: any[], replacement = '***') {
    return applyMask(text, matches, replacement);
  }

  getHoldback(rules: RuleLike[]) {
    return maxHoldback(rules);
  }

  private highest(a: string, b: string) {
    const rank: Record<string, number> = { NONE: 0, LOG: 1, MASK: 2, BLOCK: 3 };
    return rank[a] >= rank[b] ? a : b;
  }

  private validatePattern(type: SensitiveRuleType, pattern: string) {
    if (pattern.length > 500) {
      throw new AppError('pattern_too_long', 'Pattern is too long (max 500)', 400);
    }
    if (type === SensitiveRuleType.REGEX && !safeRegex(pattern)) {
      throw new AppError('unsafe_regex', 'Regular expression is too complex or unsafe', 400);
    }
  }

  private safeRule(rule: any) {
    return {
      id: rule.id,
      name: rule.name,
      category: rule.category,
      type: rule.type,
      pattern: rule.pattern,
      action: rule.action,
      direction: rule.direction,
      severity: rule.severity,
      priority: rule.priority,
      replacement: rule.replacement,
      enabled: rule.enabled,
      isBuiltin: rule.isBuiltin,
      builtinKey: rule.builtinKey,
      policyCount: rule._count?.policies,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  private safePolicy(policy: any) {
    return {
      id: policy.id,
      name: policy.name,
      description: policy.description,
      isDefault: policy.isDefault,
      ruleCount: policy._count?.rules,
      keyCount: policy._count?.keys,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }
}
