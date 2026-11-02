import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  SensitiveAction,
  SensitiveDirection,
  SensitiveRuleType,
} from '@prisma/client';

export class CreateSensitiveRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsEnum(SensitiveRuleType)
  type: SensitiveRuleType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pattern?: string;

  @IsOptional()
  @IsEnum(SensitiveAction)
  action?: SensitiveAction;

  @IsOptional()
  @IsEnum(SensitiveDirection)
  direction?: SensitiveDirection;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  severity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  replacement?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateSensitiveRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsEnum(SensitiveAction)
  action?: SensitiveAction;

  @IsOptional()
  @IsEnum(SensitiveDirection)
  direction?: SensitiveDirection;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  severity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  replacement?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pattern?: string;
}

export class CreateSensitivePolicyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ruleIds?: string[];
}

export class UpdateSensitivePolicyDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ruleIds?: string[];
}

export class TestSensitiveDto {
  @IsString()
  @MaxLength(100000)
  text: string;

  @IsOptional()
  @IsEnum(SensitiveDirection)
  direction?: SensitiveDirection;

  @IsOptional()
  @IsString()
  policyId?: string;
}
