import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

export const REFRESH_COOKIE = 'ag_refresh';

@Controller('api/admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: String(this.config.get('COOKIE_SECURE') || 'false') === 'true',
      path: '/api/admin/auth',
      maxAge: Number(this.config.get('REFRESH_TOKEN_DAYS') || 7) * 24 * 3600 * 1000,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      dto.username,
      dto.password,
      req.ip || '',
      String(req.headers['user-agent'] || ''),
    );
    res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions());
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = (req as any).cookies?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(raw, req.ip || '', String(req.headers['user-agent'] || ''));
    res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions());
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req as any).cookies?.[REFRESH_COOKIE];
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/admin/auth' });
    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() user: any) {
    return this.auth.me(user.id);
  }

  @Put('password')
  async changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
