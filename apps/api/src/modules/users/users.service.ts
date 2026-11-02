import { Injectable } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../../core/prisma.service';
import { AppError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateUserDto } from './dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const users = await this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.safe(u));
  }

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.adminUser.findUnique({ where: { username: dto.username } });
    if (exists) throw new AppError('username_exists', 'Username already exists', 409);
    const user = await this.prisma.adminUser.create({
      data: {
        username: dto.username,
        passwordHash: await hash(dto.password, 10),
        displayName: dto.displayName,
        role: dto.role,
      },
    });
    return this.safe(user);
  }

  async update(id: string, dto: UpdateUserDto, operatorId: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) throw new AppError('user_not_found', 'User not found', 404);

    const willBeAdmin = (dto.role ?? user.role) === UserRole.ADMIN;
    const willBeActive = (dto.status ?? user.status) === UserStatus.ACTIVE;
    if (user.role === UserRole.ADMIN && (!willBeAdmin || !willBeActive)) {
      const admins = await this.prisma.adminUser.count({
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      });
      if (admins <= 1) {
        throw new AppError('last_admin', 'At least one active administrator is required', 400);
      }
    }
    if (id === operatorId && dto.status === UserStatus.DISABLED) {
      throw new AppError('cannot_disable_self', 'You cannot disable your own account', 400);
    }

    const data: any = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.password) data.passwordHash = await hash(dto.password, 10);

    const updated = await this.prisma.adminUser.update({ where: { id }, data });
    if (dto.password) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return this.safe(updated);
  }

  async remove(id: string, operatorId: string) {
    if (id === operatorId) {
      throw new AppError('cannot_delete_self', 'You cannot delete your own account', 400);
    }
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) throw new AppError('user_not_found', 'User not found', 404);
    if (user.role === UserRole.ADMIN) {
      const admins = await this.prisma.adminUser.count({ where: { role: UserRole.ADMIN } });
      if (admins <= 1) {
        throw new AppError('last_admin', 'At least one administrator is required', 400);
      }
    }
    await this.prisma.adminUser.delete({ where: { id } });
    return { success: true };
  }

  private safe(user: any) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
