import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../../core/prisma.service';
import { logger } from '../../common/logger';
import { BUILTIN_RULES, DEMO_KEYWORD_RULE } from '../sensitive/builtins';
import { SensitiveRuleType } from '@prisma/client';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedUsers();
    await this.seedSensitiveRules();
    logger.info('seed completed');
  }

  private async seedUsers() {
    const reset = String(this.config.get('SEED_RESET_PASSWORDS') || 'false') === 'true';
    const accounts = [
      {
        username: this.config.get('ADMIN_USERNAME') || 'admin',
        password: this.config.get('ADMIN_PASSWORD') || 'Admin@123456',
        displayName: '系统管理员',
        role: UserRole.ADMIN,
      },
      {
        username: this.config.get('VIEWER_USERNAME') || 'viewer',
        password: this.config.get('VIEWER_PASSWORD') || 'Viewer@123456',
        displayName: '只读账号',
        role: UserRole.VIEWER,
      },
    ];

    for (const account of accounts) {
      const exists = await this.prisma.adminUser.findUnique({
        where: { username: account.username },
      });
      if (!exists) {
        await this.prisma.adminUser.create({
          data: {
            username: account.username,
            passwordHash: await hash(account.password, 10),
            displayName: account.displayName,
            role: account.role,
            status: UserStatus.ACTIVE,
          },
        });
        logger.info({ username: account.username, role: account.role }, 'seed account created');
      } else if (reset) {
        await this.prisma.adminUser.update({
          where: { id: exists.id },
          data: {
            passwordHash: await hash(account.password, 10),
            role: account.role,
            status: UserStatus.ACTIVE,
          },
        });
      }
    }
  }

  private async seedSensitiveRules() {
    const defaultPolicy =
      (await this.prisma.sensitivePolicy.findFirst({ where: { isDefault: true } })) ||
      (await this.prisma.sensitivePolicy.create({
        data: {
          name: '默认策略',
          description: '系统内置的默认敏感信息拦截策略',
          isDefault: true,
        },
      }));

    const defs = [...BUILTIN_RULES, DEMO_KEYWORD_RULE];
    for (const def of defs) {
      const existing = await this.prisma.sensitiveRule.findUnique({
        where: { builtinKey: def.key },
      });
      if (!existing) {
        await this.prisma.sensitiveRule.create({
          data: {
            name: def.name,
            category: def.category,
            type: def.key === DEMO_KEYWORD_RULE.key ? SensitiveRuleType.KEYWORD : SensitiveRuleType.BUILTIN,
            pattern: def.pattern,
            action: def.action,
            direction: def.direction,
            severity: def.severity,
            replacement: def.replacement,
            isBuiltin: def.key !== DEMO_KEYWORD_RULE.key,
            builtinKey: def.key,
          },
        });
      }
    }

    const rules = await this.prisma.sensitiveRule.findMany({ select: { id: true } });
    if (rules.length) {
      await this.prisma.sensitivePolicyRule.createMany({
        data: rules.map((r) => ({ policyId: defaultPolicy.id, ruleId: r.id })),
        skipDuplicates: true,
      });
    }
  }
}
