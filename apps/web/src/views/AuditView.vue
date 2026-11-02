<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Search, Refresh } from '@element-plus/icons-vue';
import { auditApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { formatDate, jsonPretty, shortId } from '../utils/format';

const loading = ref(false);
const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const filters = reactive({ username: '', action: '' });
const detailVisible = ref(false);
const detail = ref<any>(null);

async function load() {
  loading.value = true;
  try {
    const result = await auditApi.list({
      page: page.value,
      pageSize: pageSize.value,
      username: filters.username || undefined,
      action: filters.action || undefined,
    });
    rows.value = result.items;
    total.value = result.total;
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function reset() {
  filters.username = '';
  filters.action = '';
  page.value = 1;
  load();
}

function openDetail(row: any) {
  detail.value = row;
  detailVisible.value = true;
}

function onPageChange(p: number) {
  page.value = p;
  load();
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">审计日志</h2>
        <p class="page-subtitle">管理员登录、配置变更、Key 与规则操作留痕</p>
      </div>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>

    <div class="page-card filter-card">
      <div class="toolbar">
        <el-input v-model="filters.username" clearable placeholder="操作人" style="width: 160px" />
        <el-input v-model="filters.action" clearable placeholder="动作，如 POST /api/admin/keys" style="width: 280px" />
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
    </div>

    <div class="page-card table-card">
      <el-table v-loading="loading" :data="rows">
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="username" label="操作人" width="130" />
        <el-table-column prop="action" label="动作" min-width="280">
          <template #default="{ row }"><span class="mono tiny">{{ row.action }}</span></template>
        </el-table-column>
        <el-table-column prop="targetType" label="对象" width="120" />
        <el-table-column label="目标 ID" width="150">
          <template #default="{ row }"><span class="mono tiny">{{ shortId(row.targetId) }}</span></template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          @current-change="onPageChange"
        />
      </div>
    </div>

    <el-drawer v-model="detailVisible" title="审计详情" size="600px">
      <el-descriptions v-if="detail" :column="1" border size="small">
        <el-descriptions-item label="时间">{{ formatDate(detail.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="操作人">{{ detail.username || '-' }}</el-descriptions-item>
        <el-descriptions-item label="动作">{{ detail.action }}</el-descriptions-item>
        <el-descriptions-item label="对象">{{ detail.targetType }} / {{ detail.targetId }}</el-descriptions-item>
        <el-descriptions-item label="IP">{{ detail.ip }}</el-descriptions-item>
      </el-descriptions>
      <div v-if="detail" class="json-section">
        <div class="section-title">变更内容</div>
        <pre class="json-box">{{ jsonPretty(detail.after) }}</pre>
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

.tiny {
  font-size: 11px;
}

.mono {
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.json-section {
  margin-top: 20px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 8px;
}

.json-box {
  max-height: 420px;
  overflow: auto;
  padding: 14px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
