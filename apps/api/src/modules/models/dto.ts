import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateModelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  contextWindow?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inputPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  outputPrice?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateModelDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  contextWindow?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inputPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  outputPrice?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpsertRouteDto {
  @IsString()
  providerModelId: string;

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
