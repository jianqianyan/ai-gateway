import { Module } from '@nestjs/common';
import { SensitiveController } from './sensitive.controller';
import { SensitiveService } from './sensitive.service';

@Module({
  controllers: [SensitiveController],
  providers: [SensitiveService],
  exports: [SensitiveService],
})
export class SensitiveModule {}
