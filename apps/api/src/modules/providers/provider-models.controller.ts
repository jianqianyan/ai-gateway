import { Controller, Get } from '@nestjs/common';
import { ProvidersService } from './providers.service';

@Controller('api/admin/provider-models')
export class ProviderModelsController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  list() {
    return this.providers.listAllModels();
  }
}
