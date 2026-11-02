import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LogsService } from './logs.service';

@Controller('api/admin/logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  list(@Query() query: any) {
    return this.logs.list(query);
  }

  @Get('export')
  async export(@Query() query: any, @Res() res: Response) {
    const rows = await this.logs.exportRows(query);
    const columns = [
      'requestId',
      'createdAt',
      'keyName',
      'modelRequested',
      'providerName',
      'upstreamModel',
      'stream',
      'status',
      'httpStatus',
      'latencyMs',
      'ttftMs',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'costEstimate',
      'clientIp',
      'intercepted',
      'interceptDirection',
      'interceptSummary',
      'errorCode',
      'errorMessage',
    ];
    const esc = (v: any) => {
      if (v === null || v === undefined) return '';
      const value = v instanceof Date ? v.toISOString() : v;
      const s = String(value).replace(/"/g, '""');
      return `"${s}"`;
    };
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="ai-gateway-logs-${Date.now()}.csv"`);
    res.write('\uFEFF');
    res.write(columns.join(',') + '\n');
    for (const row of rows) {
      res.write(columns.map((c) => esc(row[c])).join(',') + '\n');
    }
    res.end();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.logs.detail(id);
  }
}
