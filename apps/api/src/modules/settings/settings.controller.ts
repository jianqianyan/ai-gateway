import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SettingsService } from './settings.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('api/admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getAll();
  }

  @Roles(UserRole.ADMIN)
  @Put()
  update(@Body() body: Record<string, any>) {
    return this.settings.update(body);
  }
}
