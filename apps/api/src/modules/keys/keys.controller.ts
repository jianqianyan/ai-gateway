import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { KeysService } from './keys.service';
import { CreateKeyDto, UpdateKeyDto } from './dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/admin/keys')
export class KeysController {
  constructor(private readonly keys: KeysService) {}

  @Get()
  list() {
    return this.keys.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.keys.findOne(id);
  }

  @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.keys.usage(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateKeyDto, @CurrentUser() user: any) {
    return this.keys.create(dto, user.id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateKeyDto) {
    return this.keys.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.keys.remove(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/rotate')
  rotate(@Param('id') id: string) {
    return this.keys.rotate(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/revoke')
  revoke(@Param('id') id: string) {
    return this.keys.revoke(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/disable')
  disable(@Param('id') id: string) {
    return this.keys.disable(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/enable')
  enable(@Param('id') id: string) {
    return this.keys.enable(id);
  }
}
