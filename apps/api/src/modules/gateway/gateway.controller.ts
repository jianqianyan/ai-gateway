import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GatewayService } from './gateway.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('v1')
@Public()
export class GatewayController {
  constructor(private readonly gateway: GatewayService) {}

  @Post('chat/completions')
  async chat(@Req() req: Request, @Res() res: Response) {
    await this.gateway.handleChat(req, res);
  }

  @Get('models')
  async models(@Req() req: Request) {
    return this.gateway.listModels(req);
  }
}
