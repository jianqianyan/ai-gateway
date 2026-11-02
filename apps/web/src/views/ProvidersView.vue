<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Connection, Delete, Edit } from '@element-plus/icons-vue';
import { providersApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { useAuthStore } from '../stores/auth';
import {
  formatDate,
  providerTypeLabels,
  statusLabels,
  statusType,
} from '../utils/format';

const auth = useAuthStore();
const isAdmin = computed(() => auth.isAdmin);
const loading = ref(false);
const providers = ref<any[]>([]);
const dialogVisible = ref(false);
const editing = ref<any>(null);
const saving = ref(false);
const formRef = ref();
const form = reactive<any>({
  name: '',
  type: 'OPENAI',
  baseUrl: '',
  apiKey: '',
  headersText: '',
  timeoutMs: 120000,
  maxRetries: 1,
  priority: 10,
  weight: 100,
  enabled: true,
});

const detailVisible = ref(false);
const detail = ref<any>(null);
const detailLoading = ref(false);
const modelDialog = ref(false);
const modelForm = reactive<any>({
  upstreamModel: '',
  displayName: '',
  capabilities: ['chat'],
  contextWindow: undefined,
});

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  baseUrl: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
};

const capabilities = [
  { label: '对话', value: 'chat' },
  { label: '视觉', value: 'vision' },
  { label: '工具调用', value: 'tools' },
  { label: 'JSON 输出', value: 'json' },
  { label: '推理', value: 'reasoning' },
  { label: '向量', value: 'embedding' },
];

async function load() {
  loading.value = true;
  try {
    providers.value = await providersApi.list();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    name: '',
    type: 'OPENAI',
    baseUrl: '',
    apiKey: '',
    headersText: '',
    timeoutMs: 120000,
    maxRetries: 1,
    priority: 10,
    weight: 100,
    enabled: true,
  });
}

function openCreate() {
  editing.value = null;
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row: any) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    type: row.type,
    baseUrl: row.baseUrl,
    apiKey: '',
    headersText: row.headers && Object.keys(row.headers).length ? JSON.stringify(row.headers, null, 2) : '',
    timeoutMs: row.timeoutMs,
    maxRetries: row.maxRetries,
    priority: row.priority,
    weight: row.weight,
    enabled: row.enabled,
  });
  dialogVisible.value = true;
}

async function save() {
  await formRef.value?.validate();
  let headers = {};
  if (form.headersText?.trim()) {
    try {
      headers = JSON.parse(form.headersText);
    } catch {
      ElMessage.error('自定义请求头必须是合法 JSON');
      return;
    }
  }
  const payload: any = {
    name: form.name,
    type: form.type,
    baseUrl: form.baseUrl,
    headers,
    timeoutMs: Number(form.timeoutMs),
    maxRetries: Number(form.maxRetries),
    priority: Number(form.priority),
    weight: Number(form.weight),
    enabled: form.enabled,
  };
  if (form.apiKey) payload.apiKey = form.apiKey;
  saving.value = true;
  try {
    if (editing.value) {
      await providersApi.update(editing.value.id, payload);
      ElMessage.success('上游已更新');
    } else {
      await providersApi.create(payload);
      ElMessage.success('上游已创建');
    }
    dialogVisible.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function testProvider(row: any) {
  const close = ElMessage.info({ message: '正在测试连接…', duration: 0 });
  try {
    const result = await providersApi.test(row.id);
    close.close();
    if (result.ok) ElMessage.success(`${result.message}（${result.latencyMs}ms）`);
    else ElMessage.error(result.message);
    await load();
  } catch (e: any) {
    close.close();
    ElMessage.error(apiErrorMessage(e));
  }
}

async function syncModels(row: any) {
  try {
    const result = await providersApi.syncModels(row.id);
    ElMessage.success(result.message || `同步完成，共 ${result.count} 个模型`);
    await load();
    if (detailVisible.value && detail.value?.id === row.id) await openDetail(row);
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function removeProvider(row: any) {
  await ElMessageBox.confirm(`确定删除上游「${row.name}」？关联的模型路由会一并删除。`, '删除确认', {
    type: 'warning',
  });
  try {
    await providersApi.remove(row.id);
    ElMessage.success('已删除');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function openDetail(row: any) {
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    detail.value = await providersApi.get(row.id);
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    detailLoading.value = false;
  }
}

async function toggleProvider(row: any) {
  try {
    await providersApi.update(row.id, { enabled: row.enabled });
    ElMessage.success(row.enabled ? '已启用' : '已禁用');
  } catch (e: any) {
    row.enabled = !row.enabled;
    ElMessage.error(apiErrorMessage(e));
  }
}

function openModelDialog() {
  Object.assign(modelForm, {
    upstreamModel: '',
    displayName: '',
    capabilities: ['chat'],
    contextWindow: undefined,
  });
  modelDialog.value = true;
}

async function addModel() {
  if (!modelForm.upstreamModel) {
    ElMessage.warning('请输入上游模型名');
    return;
  }
  try {
    await providersApi.addModel(detail.value.id, {
      upstreamModel: modelForm.upstreamModel,
      displayName: modelForm.displayName || modelForm.upstreamModel,
      capabilities: modelForm.capabilities,
      contextWindow: modelForm.contextWindow ? Number(modelForm.contextWindow) : undefined,
    });
    ElMessage.success('上游模型已添加');
    modelDialog.value = false;
    await openDetail(detail.value);
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function toggleModel(model: any) {
  try {
    await providersApi.updateModel(detail.value.id, model.id, { enabled: model.enabled });
  } catch (e: any) {
    model.enabled = !model.enabled;
    ElMessage.error(apiErrorMessage(e));
  }
}

async function removeModel(model: any) {
  await ElMessageBox.confirm(`确定删除上游模型「${model.upstreamModel}」？`, '删除确认', {
    type: 'warning',
  });
  try {
    await providersApi.removeModel(detail.value.id, model.id);
    ElMessage.success('已删除');
    await openDetail(detail.value);
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">上游管理</h2>
        <p class="page-subtitle">配置模型厂商、兼容协议、凭证与路由优先级</p>
      </div>
      <el-button v-if="isAdmin" type="primary" :icon="Plus" @click="openCreate">添加上游</el-button>
    </div>

    <div class="page-card">
      <el-table v-loading="loading" :data="providers" size="default">
        <el-table-column prop="name" label="名称" min-width="150">
          <template #default="{ row }">
            <div class="name-cell">
              <div class="provider-icon"><el-icon><Connection /></el-icon></div>
              <div>
                <div class="strong">{{ row.name }}</div>
                <div class="sub">{{ providerTypeLabels[row.type] }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="baseUrl" label="Base URL" min-width="230" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono tiny">{{ row.baseUrl }}</span></template>
        </el-table-column>
        <el-table-column label="凭证" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.hasApiKey ? 'success' : 'info'" effect="plain">
              {{ row.hasApiKey ? '已配置' : '无' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="健康" width="92">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.health)">{{ statusLabels[row.health] || row.health }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="模型" width="74">
          <template #default="{ row }">{{ row.modelCount ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="优先级 / 权重" width="120">
          <template #default="{ row }">{{ row.priority }} / {{ row.weight }}</template>
        </el-table-column>
        <el-table-column label="启用" width="76">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" :disabled="!isAdmin" size="small" @change="toggleProvider(row)" />
          </template>
        </el-table-column>
        <el-table-column label="最近检查" width="150">
          <template #default="{ row }">
            <span class="sub">{{ row.lastCheckedAt ? formatDate(row.lastCheckedAt, false) : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="isAdmin" link type="primary" @click="testProvider(row)">测试</el-button>
            <el-button v-if="isAdmin" link type="primary" @click="syncModels(row)">同步</el-button>
            <el-button v-if="isAdmin" link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="isAdmin" link type="danger" :icon="Delete" @click="removeProvider(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !providers.length" description="还没有上游，先添加一个模型来源" />
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑上游' : '添加上游'" width="620px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：OpenAI 主账号" />
        </el-form-item>
        <el-form-item label="协议类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option v-for="(label, value) in providerTypeLabels" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL" prop="baseUrl">
          <el-input v-model="form.baseUrl" placeholder="https://api.openai.com/v1" />
          <div class="form-tip">
            OpenAI 兼容填到 /v1；Anthropic 填到 /v1；Gemini 填到 /v1beta；Azure 填到 /openai/deployments 并添加 api-version 请求头。
          </div>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="editing ? (editing.hasApiKey ? '已配置，留空不修改' : '未配置') : '输入上游 API Key'"
          />
        </el-form-item>
        <el-form-item label="自定义请求头">
          <el-input v-model="form.headersText" type="textarea" :rows="3" placeholder='{"api-version":"2024-10-21"}' />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="超时 (ms)">
            <el-input-number v-model="form.timeoutMs" :min="1000" :max="600000" :step="1000" controls-position="right" />
          </el-form-item>
          <el-form-item label="重试次数">
            <el-input-number v-model="form.maxRetries" :min="0" :max="5" controls-position="right" />
          </el-form-item>
          <el-form-item label="优先级">
            <el-input-number v-model="form.priority" :min="1" :max="1000" controls-position="right" />
          </el-form-item>
          <el-form-item label="权重">
            <el-input-number v-model="form.weight" :min="1" :max="10000" controls-position="right" />
          </el-form-item>
        </div>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" :title="detail?.name || '上游详情'" size="720px">
      <div v-loading="detailLoading">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="协议">{{ detail ? providerTypeLabels[detail.type] : '-' }}</el-descriptions-item>
          <el-descriptions-item label="健康">
            <el-tag v-if="detail" size="small" :type="statusType(detail.health)">{{ statusLabels[detail.health] }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="Base URL" :span="2"><span class="mono tiny">{{ detail?.baseUrl }}</span></el-descriptions-item>
          <el-descriptions-item label="超时">{{ detail?.timeoutMs }} ms</el-descriptions-item>
          <el-descriptions-item label="最近错误"><span class="sub">{{ detail?.lastError || '-' }}</span></el-descriptions-item>
        </el-descriptions>

        <div class="drawer-actions">
          <div class="section-title">上游模型</div>
          <el-button v-if="isAdmin" size="small" type="primary" :icon="Plus" @click="openModelDialog">添加模型</el-button>
        </div>

        <el-table :data="detail?.models || []" size="small">
          <el-table-column prop="upstreamModel" label="模型名" min-width="180">
            <template #default="{ row }"><span class="mono tiny">{{ row.upstreamModel }}</span></template>
          </el-table-column>
          <el-table-column prop="displayName" label="显示名" min-width="140" />
          <el-table-column label="启用" width="76">
            <template #default="{ row }">
              <el-switch v-model="row.enabled" size="small" :disabled="!isAdmin" @change="toggleModel(row)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
              <el-button v-if="isAdmin" link type="danger" @click="removeModel(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="detail && !detail.models?.length" description="暂无模型，可同步或手工添加" />
      </div>
    </el-drawer>

    <el-dialog v-model="modelDialog" title="添加上游模型" width="480px">
      <el-form label-width="100px">
        <el-form-item label="上游模型名">
          <el-input v-model="modelForm.upstreamModel" placeholder="例如 claude-sonnet-4-20250514" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="modelForm.displayName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="能力">
          <el-select v-model="modelForm.capabilities" multiple style="width: 100%">
            <el-option v-for="c in capabilities" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="上下文">
          <el-input-number v-model="modelForm.contextWindow" :min="1" :step="1000" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="modelDialog = false">取消</el-button>
        <el-button type="primary" @click="addModel">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.strong {
  font-weight: 650;
  font-size: 13px;
}

.sub {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.tiny {
  font-size: 11px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.form-tip {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  margin-top: 4px;
}

.drawer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 22px 0 10px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
}
</style>
