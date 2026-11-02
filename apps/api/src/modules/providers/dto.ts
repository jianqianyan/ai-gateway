import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ProviderType } from '@prisma/client';

export class CreateProviderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEnum(ProviderType)
  type: ProviderType;

  @IsString()
  @MaxLength(500)
  baseUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  apiKey?: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600000)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(ProviderType)
  type?: ProviderType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  apiKey?: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600000)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class TestProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
}

export class CreateProviderModelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  upstreamModel: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  contextWindow?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateProviderModelDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  contextWindow?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
