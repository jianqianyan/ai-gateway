import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SensitiveService } from './sensitive.service';
import {
  CreateSensitivePolicyDto,
  CreateSensitiveRuleDto,
  TestSensitiveDto,
  UpdateSensitivePolicyDto,
  UpdateSensitiveRuleDto,
} from './dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('api/admin/sensitive')
export class SensitiveController {
  constructor(private readonly sensitive: SensitiveService) {}

  @Get('rules')
  listRules() {
    return this.sensitive.listRules();
  }

  @Roles(UserRole.ADMIN)
  @Post('rules')
  createRule(@Body() dto: CreateSensitiveRuleDto) {
    return this.sensitive.createRule(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateSensitiveRuleDto) {
    return this.sensitive.updateRule(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete('rules/:id')
  deleteRule(@Param('id') id: string) {
    return this.sensitive.deleteRule(id);
  }

  @Get('policies')
  listPolicies() {
    return this.sensitive.listPolicies();
  }

  @Get('policies/:id')
  getPolicy(@Param('id') id: string) {
    return this.sensitive.getPolicy(id);
  }

  @Roles(UserRole.ADMIN)
  @Post('policies')
  createPolicy(@Body() dto: CreateSensitivePolicyDto) {
    return this.sensitive.createPolicy(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch('policies/:id')
  updatePolicy(@Param('id') id: string, @Body() dto: UpdateSensitivePolicyDto) {
    return this.sensitive.updatePolicy(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post('policies/:id/default')
  setDefault(@Param('id') id: string) {
    return this.sensitive.setDefaultPolicy(id);
  }

  @Roles(UserRole.ADMIN)
  @Delete('policies/:id')
  deletePolicy(@Param('id') id: string) {
    return this.sensitive.deletePolicy(id);
  }

  @Post('test')
  test(@Body() dto: TestSensitiveDto) {
    return this.sensitive.test(dto);
  }
}
