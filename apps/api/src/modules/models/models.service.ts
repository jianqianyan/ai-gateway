import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { AppError } from '../../common/errors';
import { CreateModelDto, UpdateModelDto, UpsertRouteDto } from './dto';

@Injectable()
export class ModelsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const models = await this.prisma.model.findMany({
      include: {
        routes: {
          include: {
            providerModel: {
              include: {
                provider: { select: { id: true, name: true, type: true, enabled: true, health: true } },
              },
            },
          },
          orderBy: { priority: 'asc' },
        },
        _count: { select: { keyModels: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return models.map((m) => this.safe(m));
  }

  async findOne(id: string) {
    const model = await this.prisma.model.findUnique({
      where: { id },
      include: {
        routes: {
          include: {
            providerModel: {
              include: { provider: { select: { id: true, name: true, type: true, enabled: true } } },
            },
          },
          orderBy: { priority: 'asc' },
        },
      },
    });
    if (!model) throw new AppError('model_not_found', 'Model not found', 404);
    return this.safe(model);
  }

  async create(dto: CreateModelDto) {
    const exists = await this.prisma.model.findUnique({ where: { name: dto.name } });
    if (exists) throw new AppError('model_exists', 'Model name already exists', 409);
    const model = await this.prisma.model.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        capabilities: (dto.capabilities || ['chat']) as any,
        contextWindow: dto.contextWindow,
        inputPrice: dto.inputPrice,
        outputPrice: dto.outputPrice,
        enabled: dto.enabled ?? true,
      },
    });
    return this.safe(model);
  }

  async update(id: string, dto: UpdateModelDto) {
    const exists = await this.prisma.model.findUnique({ where: { id } });
    if (!exists) throw new AppError('model_not_found', 'Model not found', 404);
    const model = await this.prisma.model.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        description: dto.description,
        capabilities: dto.capabilities as any,
        contextWindow: dto.contextWindow,
        inputPrice: dto.inputPrice,
        outputPrice: dto.outputPrice,
        enabled: dto.enabled,
      },
    });
    return this.safe(model);
  }

  async remove(id: string) {
    const exists = await this.prisma.model.findUnique({ where: { id } });
    if (!exists) throw new AppError('model_not_found', 'Model not found', 404);
    await this.prisma.model.delete({ where: { id } });
    return { success: true };
  }

  async addRoute(modelId: string, dto: UpsertRouteDto) {
    const model = await this.prisma.model.findUnique({ where: { id: modelId } });
    if (!model) throw new AppError('model_not_found', 'Model not found', 404);
    const providerModel = await this.prisma.providerModel.findUnique({
      where: { id: dto.providerModelId },
    });
    if (!providerModel) throw new AppError('provider_model_not_found', 'Provider model not found', 404);
    const route = await this.prisma.modelRoute.upsert({
      where: {
        modelId_providerModelId: { modelId, providerModelId: dto.providerModelId },
      },
      create: {
        modelId,
        providerModelId: dto.providerModelId,
        priority: dto.priority ?? 10,
        weight: dto.weight ?? 100,
        enabled: dto.enabled ?? true,
      },
      update: {
        priority: dto.priority,
        weight: dto.weight,
        enabled: dto.enabled,
      },
    });
    return route;
  }

  async updateRoute(modelId: string, routeId: string, dto: Partial<UpsertRouteDto>) {
    const route = await this.prisma.modelRoute.findFirst({
      where: { id: routeId, modelId },
    });
    if (!route) throw new AppError('route_not_found', 'Route not found', 404);
    return this.prisma.modelRoute.update({
      where: { id: routeId },
      data: {
        priority: dto.priority,
        weight: dto.weight,
        enabled: dto.enabled,
      },
    });
  }

  async removeRoute(modelId: string, routeId: string) {
    const route = await this.prisma.modelRoute.findFirst({ where: { id: routeId, modelId } });
    if (!route) throw new AppError('route_not_found', 'Route not found', 404);
    await this.prisma.modelRoute.delete({ where: { id: routeId } });
    return { success: true };
  }

  async getRoutableByName(name: string) {
    return this.prisma.model.findUnique({
      where: { name },
      include: {
        routes: {
          where: { enabled: true },
          include: {
            providerModel: {
              include: { provider: true },
            },
          },
          orderBy: [{ priority: 'asc' }],
        },
      },
    });
  }

  async listEnabledForKeys() {
    return this.prisma.model.findMany({
      where: { enabled: true },
      select: { id: true, name: true, displayName: true, capabilities: true },
      orderBy: { name: 'asc' },
    });
  }

  private safe(model: any) {
    return {
      id: model.id,
      name: model.name,
      displayName: model.displayName,
      description: model.description,
      capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
      contextWindow: model.contextWindow,
      inputPrice: model.inputPrice === null || model.inputPrice === undefined ? null : Number(model.inputPrice),
      outputPrice: model.outputPrice === null || model.outputPrice === undefined ? null : Number(model.outputPrice),
      enabled: model.enabled,
      keyCount: model._count?.keyModels,
      routes: (model.routes || []).map((r: any) => ({
        id: r.id,
        priority: r.priority,
        weight: r.weight,
        enabled: r.enabled,
        providerModelId: r.providerModelId,
        upstreamModel: r.providerModel?.upstreamModel,
        provider: r.providerModel?.provider
          ? {
              id: r.providerModel.provider.id,
              name: r.providerModel.provider.name,
              type: r.providerModel.provider.type,
              enabled: r.providerModel.provider.enabled,
              health: r.providerModel.provider.health,
            }
          : null,
      })),
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }
}
