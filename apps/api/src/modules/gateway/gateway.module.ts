import { Module } from '@nestjs/common';
import { KeysModule } from '../keys/keys.module';
import { LogsModule } from '../logs/logs.module';
import { ModelsModule } from '../models/models.module';
import { ProvidersModule } from '../providers/providers.module';
import { SensitiveModule } from '../sensitive/sensitive.module';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { PlaygroundController } from './playground.controller';
import { RateLimitService } from './rate-limit.service';

@Module({
  imports: [KeysModule, ModelsModule, ProvidersModule, SensitiveModule, LogsModule],
  controllers: [GatewayController, PlaygroundController],
  providers: [GatewayService, RateLimitService],
})
export class GatewayModule {}
