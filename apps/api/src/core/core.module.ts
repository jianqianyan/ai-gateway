import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { EncryptionService } from './encryption.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, EncryptionService],
  exports: [PrismaService, RedisService, EncryptionService],
})
export class CoreModule {}
