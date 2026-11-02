import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ModelsService } from './models.service';
import { CreateModelDto, UpdateModelDto, UpsertRouteDto } from './dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('api/admin/models')
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  list() {
    return this.models.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.models.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateModelDto) {
    return this.models.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateModelDto) {
    return this.models.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.models.remove(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/routes')
  addRoute(@Param('id') id: string, @Body() dto: UpsertRouteDto) {
    return this.models.addRoute(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/routes/:routeId')
  updateRoute(
    @Param('id') id: string,
    @Param('routeId') routeId: string,
    @Body() dto: Partial<UpsertRouteDto>,
  ) {
    return this.models.updateRoute(id, routeId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/routes/:routeId')
  removeRoute(@Param('id') id: string, @Param('routeId') routeId: string) {
    return this.models.removeRoute(id, routeId);
  }
}
