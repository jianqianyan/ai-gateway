import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../core/prisma.service';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';

interface LoginAttempt {
  count: number;
  firstAt: number;
  blockedUntil?: number;
}

@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, LoginAttempt>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private checkThrottle(key: string) {
    const now = Date.now();
    const record = this.attempts.get(key);
    if (!record) return;
    if (record.blockedUntil && record.blockedUntil > now) {
      throw new AppError(
        'too_many_login_attempts',
        'Too many login attempts. Please try again later.',
        429,
        'rate_limit_error',
        { 'retry-after': String(Math.ceil((record.blockedUntil - now) / 1000)) },
      );
    }
    if (now - record.firstAt > 15 * 60 * 1000) {
      this.attempts.delete(key);
    }
  }

  private recordFailure(key: string) {
    const now = Date.now();
    const record = this.attempts.get(key);
    if (!record || now - record.firstAt > 15 * 60 * 1000) {
      this.attempts.set(key, { count: 1, firstAt: now });
      return;
    }
    record.count += 1;
    if (record.count >= 8) {
      record.blockedUntil = now + 15 * 60 * 1000;
    }
  }

  private clearFailures(key: string) {
    this.attempts.delete(key);
  }

  async login(username: string, password: string, ip: string, userAgent: string) {
    const throttleKey = `${ip}:${username.toLowerCase()}`;
    this.checkThrottle(throttleKey);

    const user = await this.prisma.adminUser.findUnique({
      where: { username },
    });
    if (!user || user.status !== UserStatus.ACTIVE || !(await compare(password, user.passwordHash))) {
      this.recordFailure(throttleKey);
      throw new UnauthorizedException('Invalid username or password');
    }

    this.clearFailures(throttleKey);
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { token: refreshToken, hash: refreshHash, expiresAt } = this.newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt,
        ip,
        userAgent: userAgent?.slice(0, 2000),
      },
    });

    return {
      accessToken: await this.signAccessToken(user),
      expiresIn: this.accessTtlSeconds(),
      refreshToken,
      user: this.safeUser({ ...user, lastLoginAt: new Date() }),
    };
  }

  async refresh(rawToken: string, ip: string, userAgent: string) {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');
    const tokenHash = this.sha256(rawToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    if (record.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is disabled');
    }

    const next = this.newRefreshToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: record.userId,
          tokenHash: next.hash,
          expiresAt: next.expiresAt,
          ip,
          userAgent: userAgent?.slice(0, 2000),
        },
      }),
    ]);

    return {
      accessToken: await this.signAccessToken(record.user),
      expiresIn: this.accessTtlSeconds(),
      refreshToken: next.token,
      user: this.safeUser(record.user),
    };
  }

  async logout(rawToken?: string) {
    if (!rawToken) return;
    const tokenHash = this.sha256(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user || !(await compare(currentPassword, user.passwordHash))) {
      throw new AppError('invalid_password', 'Current password is incorrect', 400);
    }
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: { passwordHash: await hash(newPassword, 10) },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.info({ userId }, 'admin password changed');
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return this.safeUser(user);
  }

  private async signAccessToken(user: { id: string; username: string; role: string; displayName?: string | null }) {
    return this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role, displayName: user.displayName },
      { expiresIn: this.config.get('JWT_ACCESS_TTL') || '900s' },
    );
  }

  private accessTtlSeconds(): number {
    const raw = String(this.config.get('JWT_ACCESS_TTL') || '900s');
    if (raw.endsWith('s')) return Number(raw.slice(0, -1)) || 900;
    if (raw.endsWith('m')) return (Number(raw.slice(0, -1)) || 15) * 60;
    if (raw.endsWith('h')) return (Number(raw.slice(0, -1)) || 1) * 3600;
    return Number(raw) || 900;
  }

  private newRefreshToken() {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + Number(this.config.get('REFRESH_TOKEN_DAYS') || 7) * 24 * 3600 * 1000,
    );
    return { token, hash: this.sha256(token), expiresAt };
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  safeUser(user: any) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}
