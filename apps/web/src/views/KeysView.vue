<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Edit, Delete, RefreshRight, View, CopyDocument } from '@element-plus/icons-vue';
import { keysApi, modelsApi, sensitiveApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { useAuthStore } from '../stores/auth';
import {
  formatCost,
  formatDate,
  formatNumber,
  statusLabels,
  statusType,
} from '../utils/format';

const auth = useAuthStore();
const isAdmin = computed(() => auth.isAdmin);
const loading = ref(false);
const keys = ref<any[]>([]);
const models = ref<any[]>([]);
const policies = ref<any[]>([]);

const createVisible = ref(false);
const step = ref(0);
const creating = ref(false);
const form = reactive<any>({
  name: '',
  owner: '',
  note: '',
  expiresAt: '',
  modelIds: [] as string[],
  sensitivePolicyId: '',
  logBody: false,
  rpmLimit: 60,
  tpmLimit: 0,
  concurrencyLimit: 5,
  dailyRequestLimit: 0,
  quotaRequests: 0,
  quotaTokens: 0,
  quotaCost: 0,
  monthlyTokenLimit: 0,
  monthlyCostLimit: 0,
  ipText: '',
});

const editVisible = ref(false);
const editId = ref('');
const editForm = reactive<any>({});
const savingEdit = ref(false);

const secretVisible = ref(false);
const secret = ref('');
const secretName = ref('');

const usageVisible = ref(false);
const usageLoading = ref(false);
const usage = ref<any>(null);

const activeModels = computed(() => models.value.filter((m) => m.enabled));

async function load() {
  loading.value = true;
  try {
    const [k, m, p] = await Promise.all([
      keysApi.list(),
      modelsApi.list(),
      sensitiveApi.policies(),
    ]);
    keys.value = k;
    models.value = m;
    policies.value = p;
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

function resetCreate() {
  step.value = 0;
  Object.assign(form, {
    name: '',
    owner: '',
    note: '',
    expiresAt: '',
    modelIds: [],
    sensitivePolicyId: '',
    logBody: false,
    rpmLimit: 60,
    tpmLimit: 0,
    concurrencyLimit: 5,
    dailyRequestLimit: 0,
    quotaRequests: 0,
    quotaTokens: 0,
    quotaCost: 0,
    monthlyTokenLimit: 0,
    monthlyCostLimit: 0,
    ipText: '',
  });
}

function openCreate() {
  resetCreate();
  createVisible.value = true;
}

function selectAllModels() {
  form.modelIds = activeModels.value.map((m) => m.id);
}

function nextStep() {
  if (step.value === 0 && !form.name.trim()) {
    ElMessage.warning('请填写 Key 名称');
    return;
  }
  if (step.value === 1 && !form.modelIds.length) {
    ElMessage.warning('请至少选择一个可用模型');
    return;
  }
  step.value = Math.min(2, step.value + 1);
}

function buildPayload(source: any) {
  const nums = (v: any) => (Number(v) > 0 ? Number(v) : undefined);
  return {
    name: source.name,
    owner: source.owner || undefined,
    note: source.note || undefined,
    expiresAt: source.expiresAt ? new Date(source.expiresAt).toISOString() : undefined,
    modelIds: source.modelIds,
    sensitivePolicyId: source.sensitivePolicyId || undefined,
    logBody: Boolean(source.logBody),
    rpmLimit: nums(source.rpmLimit),
    tpmLimit: nums(source.tpmLimit),
    concurrencyLimit: nums(source.concurrencyLimit),
    dailyRequestLimit: nums(source.dailyRequestLimit),
    quotaRequests: nums(source.quotaRequests),
    quotaTokens: nums(source.quotaTokens),
    quotaCost: Number(source.quotaCost) > 0 ? Number(source.quotaCost) : undefined,
    monthlyTokenLimit: nums(source.monthlyTokenLimit),
    monthlyCostLimit: Number(source.monthlyCostLimit) > 0 ? Number(source.monthlyCostLimit) : undefined,
    ipAllowlist: String(source.ipText || '')
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

async function createKey() {
  if (!form.modelIds.length) {
    ElMessage.warning('请至少选择一个可用模型');
    return;
  }
  creating.value = true;
  try {
    const result = await keysApi.create(buildPayload(form));
    createVisible.value = false;
    await load();
    showSecret(result.secret, result.name);
    ElMessage.success('Key 已签发');
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    creating.value = false;
  }
}

function showSecret(value: string, name: string) {
  secret.value = value;
  secretName.value = name;
  secretVisible.value = true;
}

async function copySecret() {
  try {
    await navigator.clipboard.writeText(secret.value);
    ElMessage.success('已复制到剪贴板');
  } catch {
    const input = document.createElement('textarea');
    input.value = secret.value;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    ElMessage.success('已复制到剪贴板');
  }
}

async function openEdit(row: any) {
  editId.value = row.id;
  Object.assign(editForm, {
    name: row.name,
    owner: row.owner || '',
    note: row.note || '',
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString().slice(0, 19) : '',
    modelIds: row.models.map((m: any) => m.id),
    sensitivePolicyId: row.sensitivePolicyId || '',
    logBody: row.logBody,
    rpmLimit: row.rpmLimit || 0,
    tpmLimit: row.tpmLimit || 0,
    concurrencyLimit: row.concurrencyLimit || 0,
    dailyRequestLimit: row.dailyRequestLimit || 0,
    quotaRequests: row.quotaRequests || 0,
    quotaTokens: row.quotaTokens || 0,
    quotaCost: row.quotaCost || 0,
    monthlyTokenLimit: row.monthlyTokenLimit || 0,
    monthlyCostLimit: row.monthlyCostLimit || 0,
    ipText: (row.ipAllowlist || []).join('\n'),
  });
  editVisible.value = true;
}

async function saveEdit() {
  if (!editForm.modelIds?.length) {
    ElMessage.warning('请至少选择一个可用模型');
    return;
  }
  savingEdit.value = true;
  try {
    await keysApi.update(editId.value, buildPayload(editForm));
    ElMessage.success('Key 已更新');
    editVisible.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    savingEdit.value = false;
  }
}

async function rotate(row: any) {
  await ElMessageBox.confirm(`轮换后旧 Key 立即失效，确定轮换「${row.name}」？`, '轮换 Key', {
    type: 'warning',
  });
  try {
    const result = await keysApi.rotate(row.id);
    await load();
    showSecret(result.secret, result.name);
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function toggleStatus(row: any) {
  const action = row.status === 'ACTIVE' ? 'disable' : 'enable';
  try {
    await (action === 'disable' ? keysApi.disable(row.id) : keysApi.enable(row.id));
    ElMessage.success(action === 'disable' ? '已禁用' : '已启用');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function revoke(row: any) {
  await ElMessageBox.confirm(`吊销后「${row.name}」永久不可用，确定继续？`, '吊销 Key', {
    type: 'warning',
  });
  try {
    await keysApi.revoke(row.id);
    ElMessage.success('已吊销');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确定删除 Key「${row.name}」？历史日志会保留。`, '删除 Key', {
    type: 'warning',
  });
  try {
    await keysApi.remove(row.id);
    ElMessage.success('已删除');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function openUsage(row: any) {
  usageVisible.value = true;
  usageLoading.value = true;
  usage.value = null;
  try {
    usage.value = await keysApi.usage(row.id);
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    usageLoading.value = false;
  }
}

function quotaText(row: any) {
  const parts: string[] = [];
  if (row.rpmLimit) parts.push(`${row.rpmLimit} RPM`);
  if (row.concurrencyLimit) parts.push(`${row.concurrencyLimit} 并发`);
  if (row.dailyRequestLimit) parts.push(`${row.dailyRequestLimit}/日`);
  return parts.length ? parts.join(' · ') : '不限';
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">Key 管理</h2>
        <p class="page-subtitle">签发调用凭证，按 Key 控制模型、IP、频率、配额与敏感策略</p>
      </div>
      <el-button v-if="isAdmin" type="primary" :icon="Plus" @click="openCreate">签发 Key</el-button>
    </div>

    <div class="page-card">
      <el-table v-loading="loading" :data="keys">
        <el-table-column prop="name" label="名称" min-width="150">
          <template #default="{ row }">
            <div class="strong">{{ row.name }}</div>
            <div class="sub">{{ row.owner || '未指定负责人' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Key" min-width="190">
          <template #default="{ row }">
            <span class="mono tiny key-mask">{{ row.maskedKey }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="88">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabels[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="模型授权" min-width="170">
          <template #default="{ row }">
            <el-tag v-for="m in row.models.slice(0, 2)" :key="m.id" size="small" effect="plain" class="model-tag">
              {{ m.name }}
            </el-tag>
            <el-tag v-if="row.models.length > 2" size="small" effect="plain">+{{ row.models.length - 2 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="频率限制" min-width="150">
          <template #default="{ row }"><span class="sub">{{ quotaText(row) }}</span></template>
        </el-table-column>
        <el-table-column label="用量" min-width="130">
          <template #default="{ row }">
            <div class="usage-line">
              <span>{{ formatNumber(row.usedRequests) }} 次</span>
              <span>{{ formatNumber(row.usedTokens) }} tokens</span>
            </div>
            <div class="sub">{{ formatCost(row.usedCost) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="过期" width="145">
          <template #default="{ row }">
            <span class="sub">{{ row.expiresAt ? formatDate(row.expiresAt, false) : '永不过期' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最近调用" width="145">
          <template #default="{ row }">
            <span class="sub">{{ row.lastUsedAt ? formatDate(row.lastUsedAt, false) : '从未调用' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="View" @click="openUsage(row)">用量</el-button>
            <template v-if="isAdmin">
              <el-button link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
              <el-button link type="primary" :icon="RefreshRight" @click="rotate(row)">轮换</el-button>
              <el-button link :type="row.status === 'ACTIVE' ? 'warning' : 'success'" @click="toggleStatus(row)">
                {{ row.status === 'ACTIVE' ? '禁用' : '启用' }}
              </el-button>
              <el-dropdown trigger="click">
                <el-button link type="danger">更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="revoke(row)">吊销</el-dropdown-item>
                    <el-dropdown-item divided @click="remove(row)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !keys.length" description="还没有 Key，签发一个开始调用" />
    </div>

    <el-dialog v-model="createVisible" title="签发 Key" width="760px" destroy-on-close>
      <el-steps :active="step" align-center finish-status="success" class="steps">
        <el-step title="基本信息" />
        <el-step title="模型与策略" />
        <el-step title="限制与配额" />
      </el-steps>

      <div v-if="step === 0" class="step-body">
        <el-form label-width="100px">
          <el-form-item label="名称" required>
            <el-input v-model="form.name" placeholder="例如：内容平台-生产" />
          </el-form-item>
          <el-form-item label="负责人">
            <el-input v-model="form.owner" placeholder="可选" />
          </el-form-item>
          <el-form-item label="过期时间">
            <el-date-picker v-model="form.expiresAt" type="datetime" style="width: 100%" placeholder="不填表示永不过期" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.note" type="textarea" :rows="3" placeholder="用途、环境等" />
          </el-form-item>
        </el-form>
      </div>

      <div v-else-if="step === 1" class="step-body">
        <el-form label-width="100px">
          <el-form-item label="可用模型" required>
            <div class="model-select-head">
              <span class="sub">默认不授权，必须显式勾选</span>
              <el-button link type="primary" @click="selectAllModels">全选当前模型</el-button>
            </div>
            <el-select v-model="form.modelIds" multiple filterable collapse-tags style="width: 100%" placeholder="选择允许调用的模型">
              <el-option v-for="m in activeModels" :key="m.id" :label="`${m.name} · ${m.displayName}`" :value="m.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="敏感策略">
            <el-select v-model="form.sensitivePolicyId" clearable style="width: 100%" placeholder="不选则使用默认策略">
              <el-option v-for="p in policies" :key="p.id" :label="`${p.name}${p.isDefault ? '（默认）' : ''}`" :value="p.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="记录正文">
            <el-switch v-model="form.logBody" />
            <span class="form-tip">开启后日志会保存请求/响应体（脱敏，受保留期限制）</span>
          </el-form-item>
        </el-form>
      </div>

      <div v-else class="step-body">
        <el-form label-width="120px">
          <div class="form-grid">
            <el-form-item label="RPM">
              <el-input-number v-model="form.rpmLimit" :min="0" :max="1000000" style="width: 100%" />
            </el-form-item>
            <el-form-item label="并发数">
              <el-input-number v-model="form.concurrencyLimit" :min="0" :max="10000" style="width: 100%" />
            </el-form-item>
            <el-form-item label="每日请求">
              <el-input-number v-model="form.dailyRequestLimit" :min="0" :max="100000000" style="width: 100%" />
            </el-form-item>
            <el-form-item label="TPM">
              <el-input-number v-model="form.tpmLimit" :min="0" :max="100000000" style="width: 100%" />
            </el-form-item>
            <el-form-item label="总请求配额">
              <el-input-number v-model="form.quotaRequests" :min="0" :max="100000000" style="width: 100%" />
            </el-form-item>
            <el-form-item label="总 Token 配额">
              <el-input-number v-model="form.quotaTokens" :min="0" :max="10000000000" style="width: 100%" />
            </el-form-item>
            <el-form-item label="总成本配额">
              <el-input-number v-model="form.quotaCost" :min="0" :precision="4" style="width: 100%" />
            </el-form-item>
            <el-form-item label="月度 Token">
              <el-input-number v-model="form.monthlyTokenLimit" :min="0" :max="10000000000" style="width: 100%" />
            </el-form-item>
            <el-form-item label="月度成本">
              <el-input-number v-model="form.monthlyCostLimit" :min="0" :precision="4" style="width: 100%" />
            </el-form-item>
          </div>
          <el-form-item label="IP 白名单">
            <el-input
              v-model="form.ipText"
              type="textarea"
              :rows="3"
              placeholder="每行一个 IP 或 CIDR，如 10.0.0.0/8；留空表示不限制"
            />
          </el-form-item>
          <div class="form-tip" style="padding-left: 6px">数值填 0 表示不限制。</div>
        </el-form>
      </div>

      <template #footer>
        <el-button v-if="step > 0" @click="step--">上一步</el-button>
        <el-button v-if="step < 2" type="primary" @click="nextStep">下一步</el-button>
        <el-button v-else type="primary" :loading="creating" @click="createKey">确认签发</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="secretVisible" title="请保存你的 Key" width="620px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon title="完整 Key 只展示这一次，关闭后无法再次查看。" />
      <div class="secret-box">
        <div class="secret-label">{{ secretName }}</div>
        <div class="secret-value mono">{{ secret }}</div>
        <el-button type="primary" :icon="CopyDocument" @click="copySecret">复制 Key</el-button>
      </div>
      <template #footer>
        <el-button type="primary" @click="secretVisible = false">我已保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑 Key" width="760px" destroy-on-close>
      <el-form label-width="110px">
        <div class="form-grid">
          <el-form-item label="名称">
            <el-input v-model="editForm.name" />
          </el-form-item>
          <el-form-item label="负责人">
            <el-input v-model="editForm.owner" />
          </el-form-item>
          <el-form-item label="过期时间">
            <el-date-picker v-model="editForm.expiresAt" type="datetime" style="width: 100%" />
          </el-form-item>
          <el-form-item label="敏感策略">
            <el-select v-model="editForm.sensitivePolicyId" clearable style="width: 100%">
              <el-option v-for="p in policies" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="可用模型">
          <el-select v-model="editForm.modelIds" multiple filterable collapse-tags style="width: 100%">
            <el-option v-for="m in activeModels" :key="m.id" :label="`${m.name} · ${m.displayName}`" :value="m.id" />
          </el-select>
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="RPM">
            <el-input-number v-model="editForm.rpmLimit" :min="0" style="width: 100%" />
          </el-form-item>
          <el-form-item label="并发数">
            <el-input-number v-model="editForm.concurrencyLimit" :min="0" style="width: 100%" />
          </el-form-item>
          <el-form-item label="每日请求">
            <el-input-number v-model="editForm.dailyRequestLimit" :min="0" style="width: 100%" />
          </el-form-item>
          <el-form-item label="TPM">
            <el-input-number v-model="editForm.tpmLimit" :min="0" style="width: 100%" />
          </el-form-item>
          <el-form-item label="总请求配额">
            <el-input-number v-model="editForm.quotaRequests" :min="0" style="width: 100%" />
          </el-form-item>
          <el-form-item label="总 Token 配额">
            <el-input-number v-model="editForm.quotaTokens" :min="0" style="width: 100%" />
          </el-form-item>
          <el-form-item label="总成本配额">
            <el-input-number v-model="editForm.quotaCost" :min="0" :precision="4" style="width: 100%" />
          </el-form-item>
          <el-form-item label="记录正文">
            <el-switch v-model="editForm.logBody" />
          </el-form-item>
        </div>
        <el-form-item label="IP 白名单">
          <el-input v-model="editForm.ipText" type="textarea" :rows="3" placeholder="每行一个 IP 或 CIDR" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingEdit" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="usageVisible" title="Key 用量" size="520px">
      <div v-loading="usageLoading">
        <template v-if="usage">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="名称">{{ usage.key.name }}</el-descriptions-item>
            <el-descriptions-item label="状态">{{ statusLabels[usage.key.status] }}</el-descriptions-item>
            <el-descriptions-item label="最近 30 天请求">{{ formatNumber(usage.last30Days.requests) }}</el-descriptions-item>
            <el-descriptions-item label="最近 30 天 Token">{{ formatNumber(usage.last30Days.tokens) }}</el-descriptions-item>
            <el-descriptions-item label="最近 30 天成本">{{ formatCost(usage.last30Days.cost) }}</el-descriptions-item>
            <el-descriptions-item label="拦截次数">{{ formatNumber(usage.last30Days.intercepted) }}</el-descriptions-item>
          </el-descriptions>

          <div class="usage-section">
            <div class="section-title">累计用量</div>
            <div class="usage-big">
              <div><strong>{{ formatNumber(usage.key.usedRequests) }}</strong><span>请求</span></div>
              <div><strong>{{ formatNumber(usage.key.usedTokens) }}</strong><span>Tokens</span></div>
              <div><strong>{{ formatCost(usage.key.usedCost) }}</strong><span>成本</span></div>
            </div>
          </div>

          <div class="usage-section">
            <div class="section-title">限制</div>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="RPM">{{ usage.key.rpmLimit || '不限' }}</el-descriptions-item>
              <el-descriptions-item label="并发">{{ usage.key.concurrencyLimit || '不限' }}</el-descriptions-item>
              <el-descriptions-item label="每日请求">{{ usage.key.dailyRequestLimit || '不限' }}</el-descriptions-item>
              <el-descriptions-item label="总请求配额">{{ usage.key.quotaRequests || '不限' }}</el-descriptions-item>
              <el-descriptions-item label="总 Token 配额">{{ usage.key.quotaTokens || '不限' }}</el-descriptions-item>
              <el-descriptions-item label="总成本配额">{{ usage.key.quotaCost ?? '不限' }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
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

.key-mask {
  background: var(--el-fill-color-light);
  padding: 3px 7px;
  border-radius: 5px;
}

.model-tag {
  margin-right: 5px;
  margin-bottom: 3px;
}

.usage-line {
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.steps {
  margin-bottom: 24px;
}

.step-body {
  min-height: 300px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.form-tip {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-left: 8px;
}

.model-select-head {
  display: flex;
  justify-content: space-between;
  width: 100%;
  margin-bottom: 4px;
}

.secret-box {
  margin-top: 18px;
  padding: 18px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.secret-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.secret-value {
  word-break: break-all;
  font-size: 13px;
  line-height: 1.7;
  padding: 10px;
  background: var(--el-bg-color);
  border-radius: 6px;
}

.usage-section {
  margin-top: 22px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
}

.usage-big {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.usage-big > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.usage-big strong {
  font-size: 20px;
  letter-spacing: -0.03em;
}

.usage-big span {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
</style>
