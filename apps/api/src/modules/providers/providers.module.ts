import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProviderModelsController } from './provider-models.controller';
import { ProvidersService } from './providers.service';

@Module({
  controllers: [ProvidersController, ProviderModelsController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
