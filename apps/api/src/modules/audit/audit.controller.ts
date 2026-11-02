import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('api/admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('username') username?: string,
    @Query('action') action?: string,
  ) {
    return this.audit.list({
      page: Number(page),
      pageSize: Number(pageSize),
      username,
      action,
    });
  }
}
