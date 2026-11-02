import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { logger } from '../../common/logger';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: {
    adminId?: string;
    username?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    before?: any;
    after?: any;
    ip?: string;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          adminId: entry.adminId,
          username: entry.username,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          before: entry.before ?? undefined,
          after: entry.after ?? undefined,
          ip: entry.ip,
        },
      });
    } catch (e: any) {
      logger.warn({ err: e.message }, 'failed to write audit log');
    }
  }

  async list(params: { page: number; pageSize: number; username?: string; action?: string }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    const where: any = {};
    if (params.username) where.username = { contains: params.username };
    if (params.action) where.action = { contains: params.action };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
