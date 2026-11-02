import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GatewayService } from './gateway.service';
import { AppError } from '../../common/errors';

@Controller('api/admin/playground')
export class PlaygroundController {
  constructor(private readonly gateway: GatewayService) {}

  @Post('chat')
  async chat(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const keyId = body?.keyId;
    if (!keyId) {
      throw new AppError('key_required', 'Please select an API key for the playground', 400);
    }
    const payload = { ...body };
    delete payload.keyId;
    (req as any).body = payload;
    await this.gateway.handleChat(req, res, {
      keyId,
      source: 'playground',
      skipIpCheck: true,
    });
  }
}
