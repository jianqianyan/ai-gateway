import { Controller, Get, Query } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('api/admin/stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  overview(@Query('range') range = '24h') {
    return this.stats.overview(range);
  }

  @Get('timeseries')
  timeseries(@Query('range') range = '24h') {
    return this.stats.timeseries(range);
  }

  @Get('top')
  top(@Query('range') range = '24h') {
    return this.stats.top(range);
  }

  @Get('recent')
  recent() {
    return this.stats.recent();
  }
}
