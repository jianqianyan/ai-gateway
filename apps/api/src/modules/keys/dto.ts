import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  owner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsArray()
  @IsString({ each: true })
  modelIds: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ipAllowlist?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  rpmLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  tpmLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  concurrencyLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyRequestLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quotaRequests?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quotaTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quotaCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  monthlyTokenLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyCostLimit?: number;

  @IsOptional()
  @IsString()
  sensitivePolicyId?: string;

  @IsOptional()
  @IsBoolean()
  logBody?: boolean;
}

export class UpdateKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  owner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modelIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ipAllowlist?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  rpmLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  tpmLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  concurrencyLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyRequestLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quotaRequests?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quotaTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quotaCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  monthlyTokenLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyCostLimit?: number;

  @IsOptional()
  @IsString()
  sensitivePolicyId?: string;

  @IsOptional()
  @IsBoolean()
  logBody?: boolean;
}
