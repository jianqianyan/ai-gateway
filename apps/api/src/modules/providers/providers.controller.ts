import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ProvidersService } from './providers.service';
import {
  CreateProviderDto,
  CreateProviderModelDto,
  TestProviderDto,
  UpdateProviderDto,
  UpdateProviderModelDto,
} from './dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('api/admin/providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  list() {
    return this.providers.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.providers.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateProviderDto) {
    return this.providers.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProviderDto) {
    return this.providers.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.providers.remove(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/test')
  test(@Param('id') id: string, @Body() dto: TestProviderDto) {
    return this.providers.test(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/sync-models')
  syncModels(@Param('id') id: string) {
    return this.providers.syncModels(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/models')
  addModel(@Param('id') id: string, @Body() dto: CreateProviderModelDto) {
    return this.providers.addModel(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/models/:modelId')
  updateModel(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
    @Body() dto: UpdateProviderModelDto,
  ) {
    return this.providers.updateModel(id, modelId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/models/:modelId')
  removeModel(@Param('id') id: string, @Param('modelId') modelId: string) {
    return this.providers.removeModel(id, modelId);
  }
}
