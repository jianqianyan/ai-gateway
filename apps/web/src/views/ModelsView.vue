<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Edit, Delete, Share } from '@element-plus/icons-vue';
import { modelsApi, providersApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { useAuthStore } from '../stores/auth';
import { statusLabels, statusType } from '../utils/format';

const auth = useAuthStore();
const isAdmin = computed(() => auth.isAdmin);
const loading = ref(false);
const models = ref<any[]>([]);
const providerModels = ref<any[]>([]);
const dialogVisible = ref(false);
const editing = ref<any>(null);
const saving = ref(false);
const formRef = ref();
const form = reactive<any>({
  name: '',
  displayName: '',
  description: '',
  capabilities: ['chat'],
  contextWindow: 128000,
  inputPrice: 0,
  outputPrice: 0,
  enabled: true,
});

const routeDrawer = ref(false);
const routeModel = ref<any>(null);
const routeDialog = ref(false);
const routeSaving = ref(false);
const routeForm = reactive<any>({
  providerModelId: '',
  priority: 10,
  weight: 100,
  enabled: true,
});

const capabilityOptions = [
  { label: '对话', value: 'chat' },
  { label: '视觉', value: 'vision' },
  { label: '工具调用', value: 'tools' },
  { label: 'JSON 输出', value: 'json' },
  { label: '推理', value: 'reasoning' },
  { label: '向量', value: 'embedding' },
];

const capabilityLabels: Record<string, string> = Object.fromEntries(
  capabilityOptions.map((c) => [c.value, c.label]),
);

const rules = {
  name: [{ required: true, message: '请输入模型名', trigger: 'blur' }],
  displayName: [{ required: true, message: '请输入显示名', trigger: 'blur' }],
};

async function load() {
  loading.value = true;
  try {
    const [m, pm] = await Promise.all([modelsApi.list(), providersApi.allModels()]);
    models.value = m;
    providerModels.value = pm;
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

function reset() {
  Object.assign(form, {
    name: '',
    displayName: '',
    description: '',
    capabilities: ['chat'],
    contextWindow: 128000,
    inputPrice: 0,
    outputPrice: 0,
    enabled: true,
  });
}

function openCreate() {
  editing.value = null;
  reset();
  dialogVisible.value = true;
}

function openEdit(row: any) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    displayName: row.displayName,
    description: row.description || '',
    capabilities: row.capabilities || ['chat'],
    contextWindow: row.contextWindow || undefined,
    inputPrice: row.inputPrice || 0,
    outputPrice: row.outputPrice || 0,
    enabled: row.enabled,
  });
  dialogVisible.value = true;
}

async function save() {
  await formRef.value?.validate();
  const payload: any = {
    displayName: form.displayName,
    description: form.description || undefined,
    capabilities: form.capabilities,
    contextWindow: form.contextWindow ? Number(form.contextWindow) : undefined,
    inputPrice: Number(form.inputPrice || 0),
    outputPrice: Number(form.outputPrice || 0),
    enabled: form.enabled,
  };
  saving.value = true;
  try {
    if (editing.value) {
      await modelsApi.update(editing.value.id, payload);
      ElMessage.success('模型已更新');
    } else {
      await modelsApi.create({ ...payload, name: form.name });
      ElMessage.success('模型已创建');
    }
    dialogVisible.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确定删除模型「${row.name}」？关联 Key 授权和路由会被删除。`, '删除确认', {
    type: 'warning',
  });
  try {
    await modelsApi.remove(row.id);
    ElMessage.success('已删除');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function openRoutes(row: any) {
  routeDrawer.value = true;
  try {
    routeModel.value = await modelsApi.get(row.id);
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

function openRouteDialog() {
  Object.assign(routeForm, {
    providerModelId: '',
    priority: 10,
    weight: 100,
    enabled: true,
  });
  routeDialog.value = true;
}

async function addRoute() {
  if (!routeForm.providerModelId) {
    ElMessage.warning('请选择上游模型');
    return;
  }
  routeSaving.value = true;
  try {
    await modelsApi.addRoute(routeModel.value.id, {
      providerModelId: routeForm.providerModelId,
      priority: Number(routeForm.priority),
      weight: Number(routeForm.weight),
      enabled: routeForm.enabled,
    });
    ElMessage.success('路由已添加');
    routeDialog.value = false;
    routeModel.value = await modelsApi.get(routeModel.value.id);
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    routeSaving.value = false;
  }
}

async function removeRoute(route: any) {
  await ElMessageBox.confirm('确定删除这条路由？', '删除确认', { type: 'warning' });
  try {
    await modelsApi.removeRoute(routeModel.value.id, route.id);
    ElMessage.success('已删除');
    routeModel.value = await modelsApi.get(routeModel.value.id);
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
        <h2 class="page-title">模型管理</h2>
        <p class="page-subtitle">对外的公共模型名，以及它到多个上游模型的映射与权重</p>
      </div>
      <el-button v-if="isAdmin" type="primary" :icon="Plus" @click="openCreate">创建模型</el-button>
    </div>

    <div class="page-card">
      <el-table v-loading="loading" :data="models">
        <el-table-column prop="name" label="公共模型名" min-width="180">
          <template #default="{ row }">
            <span class="mono model-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="displayName" label="显示名" min-width="140" />
        <el-table-column label="能力" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="c in row.capabilities" :key="c" size="small" effect="plain" class="cap-tag">
              {{ capabilityLabels[c] || c }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="路由" width="80">
          <template #default="{ row }">{{ row.routes?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="Key 数" width="80">
          <template #default="{ row }">{{ row.keyCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="价格 / 1M" width="150">
          <template #default="{ row }">
            <span class="sub">入 ¥{{ row.inputPrice ?? 0 }} · 出 ¥{{ row.outputPrice ?? 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="86">
          <template #default="{ row }">
            <el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Share" @click="openRoutes(row)">路由</el-button>
            <el-button v-if="isAdmin" link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="isAdmin" link type="danger" :icon="Delete" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !models.length" description="还没有公共模型，先创建一个" />
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑模型' : '创建模型'" width="620px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="公共模型名" prop="name">
          <el-input v-model="form.name" :disabled="Boolean(editing)" placeholder="客户端请求时使用的 model，如 gpt-4o-mini" />
        </el-form-item>
        <el-form-item label="显示名" prop="displayName">
          <el-input v-model="form.displayName" placeholder="如 GPT-4o mini" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="能力">
          <el-select v-model="form.capabilities" multiple style="width: 100%">
            <el-option v-for="c in capabilityOptions" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="上下文">
            <el-input-number v-model="form.contextWindow" :min="1" :step="1000" controls-position="right" />
          </el-form-item>
          <el-form-item label="状态">
            <el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" />
          </el-form-item>
          <el-form-item label="输入价">
            <el-input-number v-model="form.inputPrice" :min="0" :precision="6" :step="0.1" controls-position="right" />
          </el-form-item>
          <el-form-item label="输出价">
            <el-input-number v-model="form.outputPrice" :min="0" :precision="6" :step="0.1" controls-position="right" />
          </el-form-item>
        </div>
        <div class="form-tip">价格单位为元 / 1M tokens，仅用于成本估算。</div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="routeDrawer" :title="`路由配置 · ${routeModel?.name || ''}`" size="720px">
      <div class="drawer-head">
        <span class="sub">按优先级升序尝试；同优先级按权重随机，失败自动切换。</span>
        <el-button v-if="isAdmin" size="small" type="primary" :icon="Plus" @click="openRouteDialog">添加路由</el-button>
      </div>
      <el-table :data="routeModel?.routes || []" size="small">
        <el-table-column label="上游" min-width="150">
          <template #default="{ row }">
            <div>{{ row.provider?.name || '-' }}</div>
            <div class="sub">{{ row.provider?.type }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="upstreamModel" label="上游模型" min-width="180">
          <template #default="{ row }"><span class="mono tiny">{{ row.upstreamModel }}</span></template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="80" />
        <el-table-column prop="weight" label="权重" width="72" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button v-if="isAdmin" link type="danger" @click="removeRoute(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!routeModel?.routes?.length" description="还没有路由，添加一个上游模型" />
    </el-drawer>

    <el-dialog v-model="routeDialog" title="添加路由" width="460px">
      <el-form label-width="100px">
        <el-form-item label="上游模型">
          <el-select v-model="routeForm.providerModelId" filterable style="width: 100%" placeholder="选择上游和模型">
            <el-option
              v-for="pm in providerModels"
              :key="pm.id"
              :label="`${pm.provider?.name || '未知上游'} / ${pm.upstreamModel}`"
              :value="pm.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="routeForm.priority" :min="1" :max="1000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="权重">
          <el-input-number v-model="routeForm.weight" :min="1" :max="10000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="routeForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="routeDialog = false">取消</el-button>
        <el-button type="primary" :loading="routeSaving" @click="addRoute">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.model-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.cap-tag {
  margin-right: 5px;
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
  color: var(--el-text-color-secondary);
  font-size: 11px;
  padding-left: 110px;
}

.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
</style>
