<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Download, Refresh, Search, View } from '@element-plus/icons-vue';
import { keysApi, logsApi } from '../api';
import { apiErrorMessage } from '../api/http';
import {
  actionType,
  actionLabels,
  formatCost,
  formatDate,
  formatNumber,
  jsonPretty,
  shortId,
  statusLabels,
  statusType,
} from '../utils/format';

const loading = ref(false);
const logs = ref<any[]>([]);
const total = ref(0);
const keys = ref<any[]>([]);
const dateRange = ref<string[]>([]);
const filters = reactive<any>({
  keyId: '',
  model: '',
  status: '',
  stream: '',
  intercepted: '',
  requestId: '',
});
const page = ref(1);
const pageSize = ref(20);

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<any>(null);

function buildParams() {
  const params: any = {
    page: page.value,
    pageSize: pageSize.value,
  };
  if (dateRange.value?.length === 2) {
    params.from = new Date(dateRange.value[0]).toISOString();
    params.to = new Date(dateRange.value[1]).toISOString();
  }
  for (const key of ['keyId', 'model', 'status', 'stream', 'intercepted', 'requestId']) {
    if (filters[key]) params[key] = filters[key];
  }
  return params;
}

async function load() {
  loading.value = true;
  try {
    const result = await logsApi.list(buildParams());
    logs.value = result.items;
    total.value = result.total;
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

async function search() {
  page.value = 1;
  await load();
}

function reset() {
  filters.keyId = '';
  filters.model = '';
  filters.status = '';
  filters.stream = '';
  filters.intercepted = '';
  filters.requestId = '';
  dateRange.value = [];
  page.value = 1;
  load();
}

async function openDetail(row: any) {
  detailVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    detail.value = await logsApi.detail(row.id);
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    detailLoading.value = false;
  }
}

async function exportCsv() {
  try {
    await logsApi.exportCsv(buildParams());
    ElMessage.success('CSV 已开始下载');
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

function onPageChange(p: number) {
  page.value = p;
  load();
}

function onSizeChange(s: number) {
  pageSize.value = s;
  page.value = 1;
  load();
}

onMounted(async () => {
  await load();
  try {
    keys.value = await keysApi.list();
  } catch {
    // ignore
  }
});
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">调用日志</h2>
        <p class="page-subtitle">全链路记录请求、路由、Token、耗时和安全拦截</p>
      </div>
      <div>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Download" @click="exportCsv">导出 CSV</el-button>
      </div>
    </div>

    <div class="page-card filter-card">
      <div class="toolbar">
        <el-date-picker
          v-model="dateRange"
          type="datetimerange"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          value-format="YYYY-MM-DDTHH:mm:ss"
          style="width: 350px"
        />
        <el-select v-model="filters.keyId" clearable filterable placeholder="全部 Key" style="width: 170px">
          <el-option v-for="k in keys" :key="k.id" :label="k.name" :value="k.id" />
        </el-select>
        <el-input v-model="filters.model" clearable placeholder="模型名" style="width: 150px" />
        <el-select v-model="filters.status" clearable placeholder="状态" style="width: 120px">
          <el-option label="成功" value="SUCCESS" />
          <el-option label="失败" value="ERROR" />
          <el-option label="已拦截" value="BLOCKED" />
          <el-option label="已取消" value="CANCELLED" />
        </el-select>
        <el-select v-model="filters.stream" clearable placeholder="流式" style="width: 100px">
          <el-option label="流式" value="true" />
          <el-option label="非流式" value="false" />
        </el-select>
        <el-select v-model="filters.intercepted" clearable placeholder="拦截" style="width: 110px">
          <el-option label="已拦截" value="true" />
          <el-option label="未拦截" value="false" />
        </el-select>
        <el-input v-model="filters.requestId" clearable placeholder="request_id" style="width: 190px" />
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
    </div>

    <div class="page-card table-card">
      <el-table v-loading="loading" :data="logs" size="default">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">
            <div>{{ formatDate(row.createdAt, false) }}</div>
            <div class="sub">{{ row.stream ? '流式' : '非流式' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Request ID" min-width="150">
          <template #default="{ row }">
            <el-tooltip :content="row.requestId" placement="top">
              <span class="mono tiny">{{ shortId(row.requestId, 12, 4) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="keyName" label="Key" min-width="110" show-overflow-tooltip />
        <el-table-column label="模型" min-width="130">
          <template #default="{ row }">
            <div>{{ row.modelRequested }}</div>
            <div class="sub">{{ row.upstreamModel || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="providerName" label="上游" min-width="120" show-overflow-tooltip />
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabels[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="84">
          <template #default="{ row }">{{ row.latencyMs }} ms</template>
        </el-table-column>
        <el-table-column label="Token" width="94">
          <template #default="{ row }">
            <div>{{ formatNumber(row.totalTokens) }}</div>
            <div class="sub">入 {{ row.inputTokens || 0 }} / 出 {{ row.outputTokens || 0 }}</div>
          </template>
        </el-table-column>
        <el-table-column label="成本" width="100">
          <template #default="{ row }"><span class="sub">{{ formatCost(row.costEstimate) }}</span></template>
        </el-table-column>
        <el-table-column label="安全" width="92">
          <template #default="{ row }">
            <el-tag v-if="row.intercepted" size="small" :type="actionType(row.interceptAction)">
              {{ actionLabels[row.interceptAction] || '拦截' }}
            </el-tag>
            <span v-else class="sub">正常</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="76" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="View" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </div>
    </div>

    <el-drawer v-model="detailVisible" title="调用详情" size="760px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <div class="detail-head">
            <div>
              <div class="detail-model">{{ detail.modelRequested }}</div>
              <div class="mono tiny">{{ detail.requestId }}</div>
            </div>
            <el-tag :type="statusType(detail.status)">{{ statusLabels[detail.status] || detail.status }}</el-tag>
          </div>

          <el-alert
            v-if="detail.intercepted"
            type="warning"
            :closable="false"
            show-icon
            class="intercept-alert"
            :title="`${detail.interceptDirection === 'INPUT' ? '输入' : '输出'}敏感信息已${actionLabels[detail.interceptAction] || '处理'}`"
            :description="detail.interceptSummary || '命中敏感规则'"
          />

          <el-descriptions :column="3" border size="small" class="detail-desc">
            <el-descriptions-item label="Key">{{ detail.keyName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="上游">{{ detail.providerName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="上游模型">{{ detail.upstreamModel || '-' }}</el-descriptions-item>
            <el-descriptions-item label="状态码">{{ detail.httpStatus }}</el-descriptions-item>
            <el-descriptions-item label="总耗时">{{ detail.latencyMs }} ms</el-descriptions-item>
            <el-descriptions-item label="首 Token">{{ detail.ttftMs ?? '-' }} ms</el-descriptions-item>
            <el-descriptions-item label="输入 Token">{{ detail.inputTokens ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="输出 Token">{{ detail.outputTokens ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="总 Token">{{ detail.totalTokens ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="成本">{{ formatCost(detail.costEstimate) }}</el-descriptions-item>
            <el-descriptions-item label="客户端 IP">{{ detail.clientIp || '-' }}</el-descriptions-item>
            <el-descriptions-item label="来源">{{ detail.source || 'API' }}</el-descriptions-item>
            <el-descriptions-item label="错误码">{{ detail.errorCode || '-' }}</el-descriptions-item>
            <el-descriptions-item label="上游 Request ID" :span="2">{{ detail.upstreamRequestId || '-' }}</el-descriptions-item>
          </el-descriptions>

          <div v-if="detail.errorMessage" class="section">
            <div class="section-title">错误信息</div>
            <el-alert type="error" :closable="false" :title="detail.errorMessage" />
          </div>

          <div class="section">
            <div class="section-title">路由尝试</div>
            <el-table :data="detail.attempts" size="small">
              <el-table-column prop="providerName" label="上游" min-width="140" />
              <el-table-column prop="upstreamModel" label="模型" min-width="140" />
              <el-table-column prop="status" label="结果" width="90">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.status === 'success' ? 'success' : 'danger'">
                    {{ row.status === 'success' ? '成功' : '失败' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="latencyMs" label="耗时" width="80">
                <template #default="{ row }">{{ row.latencyMs ?? '-' }}ms</template>
              </el-table-column>
              <el-table-column prop="error" label="错误" min-width="160" show-overflow-tooltip />
            </el-table>
            <div v-if="!detail.attempts?.length" class="sub">没有上游尝试记录</div>
          </div>

          <div v-if="detail.body" class="section">
            <div class="section-title">请求 / 响应体 <span class="sub">（已脱敏）</span></div>
            <el-tabs>
              <el-tab-pane label="请求">
                <pre class="json-box">{{ jsonPretty(detail.body.requestBody) }}</pre>
              </el-tab-pane>
              <el-tab-pane label="响应">
                <pre class="json-box">{{ jsonPretty(detail.body.responseBody) }}</pre>
              </el-tab-pane>
            </el-tabs>
          </div>
          <el-alert v-else type="info" :closable="false" title="该 Key 未开启正文记录，仅保留元数据。" class="body-tip" />
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.filter-card {
  padding: 14px 16px;
}

.filter-card .toolbar {
  margin-bottom: 0;
}

.table-card {
  margin-top: 14px;
}

.sub {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.tiny {
  font-size: 11px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.detail-model {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.intercept-alert {
  margin-bottom: 16px;
}

.detail-desc {
  margin-bottom: 18px;
}

.section {
  margin-top: 22px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
}

.json-box {
  max-height: 360px;
  overflow: auto;
  padding: 14px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-all;
}

.body-tip {
  margin-top: 20px;
}
</style>
