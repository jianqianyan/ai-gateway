<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ElMessage } from 'element-plus';
import { statsApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { formatDate, formatNumber, statusType, statusLabels } from '../utils/format';
import StatCard from '../components/StatCard.vue';

dayjs.extend(utc);

const range = ref('24h');
const loading = ref(false);
const overview = ref<any>({});
const top = ref<any>({ models: [], keys: [], providers: [], errors: [] });
const recent = ref<any[]>([]);
const trendRef = ref<HTMLDivElement>();
const modelRef = ref<HTMLDivElement>();
let trendChart: echarts.ECharts | null = null;
let modelChart: echarts.ECharts | null = null;

async function load() {
  loading.value = true;
  try {
    const [o, t, tp, r] = await Promise.all([
      statsApi.overview(range.value),
      statsApi.timeseries(range.value),
      statsApi.top(range.value),
      statsApi.recent(),
    ]);
    overview.value = o;
    top.value = tp;
    recent.value = r;
    await nextTick();
    renderCharts(t);
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

function formatBucket(bucket: string) {
  if (!bucket) return '';
  if (bucket.length <= 10) return dayjs.utc(bucket).local().format('MM-DD');
  return dayjs.utc(bucket).local().format('HH:mm');
}

function renderCharts(series: any[]) {
  if (trendRef.value) {
    trendChart = trendChart || echarts.init(trendRef.value);
    trendChart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { right: 8, top: 0, textStyle: { fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 42, right: 18, top: 40, bottom: 28 },
      xAxis: {
        type: 'category',
        data: series.map((s) => formatBucket(s.bucket)),
        axisLabel: { fontSize: 10, color: '#94a3b8' },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
      },
      yAxis: [
        {
          type: 'value',
          axisLabel: { fontSize: 10, color: '#94a3b8' },
          splitLine: { lineStyle: { color: 'rgba(148,163,184,.15)' } },
        },
        {
          type: 'value',
          axisLabel: { fontSize: 10, color: '#94a3b8' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '请求数',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: series.map((s) => s.requests),
          lineStyle: { width: 2.5, color: '#3b82f6' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(59,130,246,.25)' },
              { offset: 1, color: 'rgba(59,130,246,0)' },
            ]),
          },
        },
        {
          name: '错误',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: series.map((s) => s.errors),
          lineStyle: { width: 1.5, color: '#ef4444' },
        },
        {
          name: 'Token',
          type: 'bar',
          yAxisIndex: 1,
          data: series.map((s) => s.tokens),
          barMaxWidth: 14,
          itemStyle: { color: 'rgba(139,92,246,.32)', borderRadius: [4, 4, 0, 0] },
        },
      ],
    });
  }

  if (!top.value.models?.length) {
    modelChart?.dispose();
    modelChart = null;
    return;
  }

  if (modelRef.value) {
    modelChart = modelChart || echarts.init(modelRef.value);
    const items = [...(top.value.models || [])].reverse();
    modelChart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 100, right: 24, top: 10, bottom: 22 },
      xAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#94a3b8' },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,.15)' } },
      },
      yAxis: {
        type: 'category',
        data: items.map((m) => m.name),
        axisLabel: { fontSize: 11, color: '#64748b' },
        axisLine: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: items.map((m) => m.requests),
          barWidth: 12,
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: '#6366f1' },
              { offset: 1, color: '#38bdf8' },
            ]),
          },
        },
      ],
    });
  }
}

function resize() {
  trendChart?.resize();
  modelChart?.resize();
}

watch(range, load);
onMounted(() => {
  load();
  window.addEventListener('resize', resize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  trendChart?.dispose();
  modelChart?.dispose();
});
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">运行概览</h2>
        <p class="page-subtitle">请求、延迟、Token 与安全拦截的实时汇总</p>
      </div>
      <el-radio-group v-model="range" size="small">
        <el-radio-button value="24h">24 小时</el-radio-button>
        <el-radio-button value="7d">7 天</el-radio-button>
        <el-radio-button value="30d">30 天</el-radio-button>
      </el-radio-group>
    </div>

    <el-skeleton :loading="loading && !overview.requests" animated>
      <template #template>
        <div class="skeleton-grid">
          <el-skeleton-item v-for="i in 6" :key="i" variant="rect" style="height: 112px; border-radius: 14px" />
        </div>
      </template>
      <template #default>
        <div class="stats-grid">
          <StatCard label="请求总数" :value="formatNumber(overview.requests)" :hint="`成功率 ${overview.successRate ?? 0}%`" tone="blue" />
          <StatCard label="Token 消耗" :value="formatNumber(overview.tokens)" hint="输入 + 输出" tone="violet" />
          <StatCard label="平均延迟" :value="`${overview.avgLatencyMs ?? 0} ms`" :hint="`P95 ${overview.p95LatencyMs ?? 0} ms`" tone="green" />
          <StatCard label="首 Token" :value="`${overview.avgTtftMs ?? 0} ms`" hint="流式平均 TTFT" tone="orange" />
          <StatCard label="拦截次数" :value="formatNumber(overview.intercepted)" :hint="`${overview.blocked ?? 0} 次直接阻断`" tone="red" />
          <StatCard label="活跃 Key" :value="formatNumber(overview.activeKeys)" :hint="`成本估算 ¥${Number(overview.cost || 0).toFixed(6)}`" tone="slate" />
        </div>

        <div class="chart-grid">
          <div class="page-card chart-card">
            <div class="card-title">请求趋势</div>
            <div ref="trendRef" class="chart"></div>
          </div>
          <div class="page-card chart-card">
            <div class="card-title">模型调用 Top</div>
            <div class="chart-wrap">
              <div ref="modelRef" class="chart"></div>
              <div v-if="!top.models.length" class="empty">暂无调用数据</div>
            </div>
          </div>
        </div>

        <div class="bottom-grid">
          <div class="page-card">
            <div class="card-title">最近调用</div>
            <el-table :data="recent" size="small" class="recent-table">
              <el-table-column prop="createdAt" label="时间" width="150">
                <template #default="{ row }">{{ formatDate(row.createdAt, false) }}</template>
              </el-table-column>
              <el-table-column prop="keyName" label="Key" min-width="110" show-overflow-tooltip />
              <el-table-column prop="modelRequested" label="模型" min-width="120" show-overflow-tooltip />
              <el-table-column prop="providerName" label="上游" min-width="120" show-overflow-tooltip />
              <el-table-column label="状态" width="82">
                <template #default="{ row }">
                  <el-tag size="small" :type="statusType(row.status)">{{ statusLabels[row.status] || row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="耗时" width="78">
                <template #default="{ row }">{{ row.latencyMs }}ms</template>
              </el-table-column>
              <el-table-column label="Token" width="78">
                <template #default="{ row }">{{ row.totalTokens || '-' }}</template>
              </el-table-column>
            </el-table>
            <div v-if="!recent.length" class="empty">暂无调用记录</div>
          </div>

          <div class="page-card">
            <div class="card-title">调用分布</div>
            <div class="rank-block">
              <div class="rank-title">按 Key</div>
              <div v-for="item in top.keys.slice(0, 5)" :key="item.name" class="rank-row">
                <span class="ellipsis">{{ item.name }}</span>
                <strong>{{ item.requests }}</strong>
              </div>
              <div v-if="!top.keys.length" class="empty small">暂无数据</div>
            </div>
            <div class="rank-block">
              <div class="rank-title">按上游</div>
              <div v-for="item in top.providers.slice(0, 5)" :key="item.name" class="rank-row">
                <span class="ellipsis">{{ item.name }}</span>
                <strong>{{ item.requests }}</strong>
              </div>
              <div v-if="!top.providers.length" class="empty small">暂无数据</div>
            </div>
          </div>
        </div>
      </template>
    </el-skeleton>
  </div>
</template>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.chart-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 14px;
  margin-top: 16px;
}

.chart-card {
  padding-bottom: 10px;
}

.card-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}

.chart {
  width: 100%;
  height: 280px;
}

.chart-wrap {
  position: relative;
}

.chart-wrap .empty {
  position: absolute;
  inset: 0;
  height: auto;
  background: var(--el-bg-color);
}

.bottom-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 14px;
  margin-top: 16px;
}

.recent-table {
  margin-top: 6px;
}

.rank-block {
  margin-top: 12px;
}

.rank-title {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.rank-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.rank-row strong {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
}

.empty {
  height: 240px;
  display: grid;
  place-items: center;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.empty.small {
  height: 50px;
}

@media (max-width: 1400px) {
  .stats-grid,
  .skeleton-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
