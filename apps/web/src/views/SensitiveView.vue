<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Edit, Delete, Star, MagicStick } from '@element-plus/icons-vue';
import { sensitiveApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { useAuthStore } from '../stores/auth';
import {
  actionLabels,
  actionType,
  directionLabels,
  ruleTypeLabels,
  statusLabels,
  statusType,
} from '../utils/format';

const auth = useAuthStore();
const isAdmin = computed(() => auth.isAdmin);
const tab = ref('rules');
const loading = ref(false);
const rules = ref<any[]>([]);
const policies = ref<any[]>([]);

const ruleVisible = ref(false);
const editingRule = ref<any>(null);
const ruleSaving = ref(false);
const ruleForm = reactive<any>({
  name: '',
  category: '自定义',
  type: 'KEYWORD',
  pattern: '',
  action: 'BLOCK',
  direction: 'BOTH',
  severity: 70,
  replacement: '***',
  enabled: true,
});

const policyVisible = ref(false);
const editingPolicy = ref<any>(null);
const policySaving = ref(false);
const policyForm = reactive<any>({
  name: '',
  description: '',
  isDefault: false,
  ruleIds: [] as string[],
});

const testText = ref('我的手机号是 13800138000，内部机密是 ORION-7，邮箱 dev@example.com');
const testDirection = ref('BOTH');
const testPolicyId = ref('');
const testing = ref(false);
const testResult = ref<any>(null);

const highlighted = computed(() => {
  const text = testText.value || '';
  const matches = testResult.value?.matches || [];
  if (!matches.length) return escapeHtml(text);
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let html = '';
  for (const m of sorted) {
    if (m.start < cursor) continue;
    html += escapeHtml(text.slice(cursor, m.start));
    html += `<mark class="hit ${m.action === 'BLOCK' ? 'block' : m.action === 'MASK' ? 'mask' : 'log'}" title="${escapeHtml(m.ruleName)}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    cursor = m.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function load() {
  loading.value = true;
  try {
    const [r, p] = await Promise.all([sensitiveApi.rules(), sensitiveApi.policies()]);
    rules.value = r;
    policies.value = p;
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

function resetRule() {
  Object.assign(ruleForm, {
    name: '',
    category: '自定义',
    type: 'KEYWORD',
    pattern: '',
    action: 'BLOCK',
    direction: 'BOTH',
    severity: 70,
    replacement: '***',
    enabled: true,
  });
}

function openRuleCreate() {
  editingRule.value = null;
  resetRule();
  ruleVisible.value = true;
}

function openRuleEdit(row: any) {
  editingRule.value = row;
  Object.assign(ruleForm, {
    name: row.name,
    category: row.category,
    type: row.type,
    pattern: row.pattern || '',
    action: row.action,
    direction: row.direction,
    severity: row.severity,
    replacement: row.replacement || '***',
    enabled: row.enabled,
  });
  ruleVisible.value = true;
}

async function saveRule() {
  if (!ruleForm.name) {
    ElMessage.warning('请填写规则名称');
    return;
  }
  if (ruleForm.type !== 'BUILTIN' && !ruleForm.pattern) {
    ElMessage.warning('请填写关键词或正则');
    return;
  }
  ruleSaving.value = true;
  try {
    const payload: any = {
      name: ruleForm.name,
      category: ruleForm.category,
      action: ruleForm.action,
      direction: ruleForm.direction,
      severity: Number(ruleForm.severity),
      replacement: ruleForm.replacement,
      enabled: ruleForm.enabled,
    };
    if (ruleForm.type !== 'BUILTIN') {
      payload.type = ruleForm.type;
      payload.pattern = ruleForm.pattern;
    }
    if (editingRule.value) {
      await sensitiveApi.updateRule(editingRule.value.id, payload);
      ElMessage.success('规则已更新');
    } else {
      await sensitiveApi.createRule(payload);
      ElMessage.success('规则已创建并加入默认策略');
    }
    ruleVisible.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    ruleSaving.value = false;
  }
}

async function deleteRule(row: any) {
  await ElMessageBox.confirm(`确定删除规则「${row.name}」？`, '删除规则', { type: 'warning' });
  try {
    await sensitiveApi.removeRule(row.id);
    ElMessage.success('已删除');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function toggleRule(row: any) {
  try {
    await sensitiveApi.updateRule(row.id, { enabled: row.enabled });
    ElMessage.success(row.enabled ? '规则已启用' : '规则已停用');
  } catch (e: any) {
    row.enabled = !row.enabled;
    ElMessage.error(apiErrorMessage(e));
  }
}

function resetPolicy() {
  Object.assign(policyForm, {
    name: '',
    description: '',
    isDefault: false,
    ruleIds: [],
  });
}

function openPolicyCreate() {
  editingPolicy.value = null;
  resetPolicy();
  policyVisible.value = true;
}

async function openPolicyEdit(row: any) {
  try {
    const detail = await sensitiveApi.policy(row.id);
    editingPolicy.value = row;
    Object.assign(policyForm, {
      name: detail.name,
      description: detail.description || '',
      isDefault: detail.isDefault,
      ruleIds: detail.rules.map((r: any) => r.id),
    });
    policyVisible.value = true;
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function savePolicy() {
  if (!policyForm.name) {
    ElMessage.warning('请填写策略名称');
    return;
  }
  policySaving.value = true;
  try {
    const payload = {
      name: policyForm.name,
      description: policyForm.description || undefined,
      isDefault: policyForm.isDefault,
      ruleIds: policyForm.ruleIds,
    };
    if (editingPolicy.value) {
      await sensitiveApi.updatePolicy(editingPolicy.value.id, payload);
      ElMessage.success('策略已更新');
    } else {
      await sensitiveApi.createPolicy(payload);
      ElMessage.success('策略已创建');
    }
    policyVisible.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    policySaving.value = false;
  }
}

async function setDefault(row: any) {
  try {
    await sensitiveApi.setDefault(row.id);
    ElMessage.success('已设为默认策略');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function deletePolicy(row: any) {
  await ElMessageBox.confirm(`确定删除策略「${row.name}」？`, '删除策略', { type: 'warning' });
  try {
    await sensitiveApi.removePolicy(row.id);
    ElMessage.success('已删除');
    await load();
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  }
}

async function runTest() {
  if (!testText.value.trim()) {
    ElMessage.warning('请输入测试文本');
    return;
  }
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await sensitiveApi.test({
      text: testText.value,
      direction: testDirection.value,
      policyId: testPolicyId.value || undefined,
    });
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    testing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">敏感信息拦截</h2>
        <p class="page-subtitle">关键词、正则和内置 PII/密钥规则；输入与输出双向检测</p>
      </div>
      <el-button v-if="isAdmin" type="primary" :icon="Plus" @click="tab === 'rules' ? openRuleCreate() : openPolicyCreate()">
        {{ tab === 'rules' ? '新建规则' : '新建策略' }}
      </el-button>
    </div>

    <div class="page-card">
      <el-tabs v-model="tab">
        <el-tab-pane label="规则列表" name="rules">
          <el-table v-loading="loading" :data="rules">
            <el-table-column prop="name" label="规则" min-width="200">
              <template #default="{ row }">
                <div class="strong">{{ row.name }}</div>
                <div class="sub">{{ row.category }}</div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ ruleTypeLabels[row.type] || row.type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="匹配内容" min-width="240">
              <template #default="{ row }">
                <span class="mono tiny pattern">{{ row.pattern || '内置检测器' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="方向" width="80">
              <template #default="{ row }">{{ directionLabels[row.direction] }}</template>
            </el-table-column>
            <el-table-column label="动作" width="86">
              <template #default="{ row }">
                <el-tag size="small" :type="actionType(row.action)">{{ actionLabels[row.action] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="severity" label="级别" width="70" />
            <el-table-column label="启用" width="76">
              <template #default="{ row }">
                <el-switch v-model="row.enabled" size="small" :disabled="!isAdmin" @change="toggleRule(row)" />
              </template>
            </el-table-column>
            <el-table-column label="策略数" width="80">
              <template #default="{ row }">{{ row.policyCount ?? 0 }}</template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button v-if="isAdmin" link type="primary" :icon="Edit" @click="openRuleEdit(row)">编辑</el-button>
                <el-button v-if="isAdmin && !row.isBuiltin" link type="danger" :icon="Delete" @click="deleteRule(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="策略集" name="policies">
          <el-table v-loading="loading" :data="policies">
            <el-table-column prop="name" label="策略" min-width="220">
              <template #default="{ row }">
                <div class="strong">
                  {{ row.name }}
                  <el-tag v-if="row.isDefault" size="small" type="success" effect="plain">默认</el-tag>
                </div>
                <div class="sub">{{ row.description || '无描述' }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="ruleCount" label="规则数" width="90" />
            <el-table-column prop="keyCount" label="关联 Key" width="100" />
            <el-table-column label="操作" width="260" fixed="right">
              <template #default="{ row }">
                <el-button v-if="isAdmin && !row.isDefault" link type="success" :icon="Star" @click="setDefault(row)">设为默认</el-button>
                <el-button v-if="isAdmin" link type="primary" :icon="Edit" @click="openPolicyEdit(row)">编辑</el-button>
                <el-button v-if="isAdmin && !row.isDefault" link type="danger" :icon="Delete" @click="deletePolicy(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="规则测试器" name="test">
          <div class="test-grid">
            <div>
              <div class="test-label">测试文本</div>
              <el-input v-model="testText" type="textarea" :rows="10" placeholder="输入包含手机号、身份证、密钥或自定义敏感词的内容" />
              <div class="test-controls">
                <el-select v-model="testDirection" style="width: 120px">
                  <el-option label="双向" value="BOTH" />
                  <el-option label="仅输入" value="INPUT" />
                  <el-option label="仅输出" value="OUTPUT" />
                </el-select>
                <el-select v-model="testPolicyId" clearable placeholder="默认策略" style="width: 200px">
                  <el-option v-for="p in policies" :key="p.id" :label="p.name" :value="p.id" />
                </el-select>
                <el-button type="primary" :icon="MagicStick" :loading="testing" @click="runTest">开始检测</el-button>
              </div>
            </div>
            <div>
              <div class="test-label">检测结果</div>
              <div class="preview" v-html="highlighted"></div>
              <div v-if="testResult" class="result-summary">
                <el-tag :type="testResult.action === 'BLOCK' ? 'danger' : testResult.action === 'MASK' ? 'warning' : testResult.action === 'LOG' ? 'info' : 'success'">
                  {{ testResult.action === 'NONE' ? '未命中' : actionLabels[testResult.action] }}
                </el-tag>
                <span class="sub">命中 {{ testResult.matches?.length || 0 }} 处 · 规则 {{ testResult.ruleCount }} 条 · {{ testResult.elapsedMs }}ms</span>
              </div>
            </div>
          </div>

          <el-table v-if="testResult?.matches?.length" :data="testResult.matches" size="small" class="match-table">
            <el-table-column prop="ruleName" label="规则" min-width="180" />
            <el-table-column prop="category" label="类别" width="110" />
            <el-table-column prop="action" label="动作" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="actionType(row.action)">{{ actionLabels[row.action] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="masked" label="命中内容（脱敏）" min-width="180" />
            <el-table-column prop="start" label="位置" width="90" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog v-model="ruleVisible" :title="editingRule ? '编辑规则' : '新建规则'" width="620px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="名称" required>
          <el-input v-model="ruleForm.name" />
        </el-form-item>
        <el-form-item label="类别">
          <el-input v-model="ruleForm.category" placeholder="个人隐私 / 凭证密钥 / 自定义" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="ruleForm.type" :disabled="Boolean(editingRule)">
            <el-radio-button value="KEYWORD">关键词</el-radio-button>
            <el-radio-button value="REGEX">正则</el-radio-button>
            <el-radio-button v-if="editingRule?.isBuiltin" value="BUILTIN">内置</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="ruleForm.type !== 'BUILTIN'" label="匹配内容" required>
          <el-input
            v-model="ruleForm.pattern"
            type="textarea"
            :rows="3"
            :placeholder="ruleForm.type === 'KEYWORD' ? '例如：内部机密' : '例如：\\\\d{17}[\\\\dXx]'"
          />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="动作">
            <el-select v-model="ruleForm.action" style="width: 100%">
              <el-option label="阻断" value="BLOCK" />
              <el-option label="脱敏" value="MASK" />
              <el-option label="仅记录" value="LOG" />
            </el-select>
          </el-form-item>
          <el-form-item label="方向">
            <el-select v-model="ruleForm.direction" style="width: 100%">
              <el-option label="双向" value="BOTH" />
              <el-option label="输入" value="INPUT" />
              <el-option label="输出" value="OUTPUT" />
            </el-select>
          </el-form-item>
          <el-form-item label="严重级别">
            <el-input-number v-model="ruleForm.severity" :min="0" :max="100" style="width: 100%" />
          </el-form-item>
          <el-form-item label="替换文本">
            <el-input v-model="ruleForm.replacement" />
          </el-form-item>
        </div>
        <el-form-item label="启用">
          <el-switch v-model="ruleForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleVisible = false">取消</el-button>
        <el-button type="primary" :loading="ruleSaving" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="policyVisible" :title="editingPolicy ? '编辑策略' : '新建策略'" width="620px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="名称" required>
          <el-input v-model="policyForm.name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="policyForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="包含规则">
          <el-select v-model="policyForm.ruleIds" multiple filterable collapse-tags style="width: 100%" placeholder="选择规则">
            <el-option v-for="r in rules" :key="r.id" :label="`${r.name}（${actionLabels[r.action]}）`" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="设为默认">
          <el-switch v-model="policyForm.isDefault" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="policyVisible = false">取消</el-button>
        <el-button type="primary" :loading="policySaving" @click="savePolicy">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.strong {
  font-weight: 650;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sub {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.tiny {
  font-size: 11px;
}

.pattern {
  background: var(--el-fill-color-light);
  padding: 3px 6px;
  border-radius: 5px;
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.test-label {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}

.test-controls {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.preview {
  min-height: 232px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-lighter);
  font-size: 13px;
  line-height: 2;
  white-space: pre-wrap;
  word-break: break-word;
}

.preview :deep(mark.hit) {
  padding: 1px 3px;
  border-radius: 4px;
}

.preview :deep(mark.block) {
  background: rgba(239, 68, 68, 0.2);
  color: #dc2626;
}

.preview :deep(mark.mask) {
  background: rgba(245, 158, 11, 0.22);
  color: #b45309;
}

.preview :deep(mark.log) {
  background: rgba(59, 130, 246, 0.18);
  color: #2563eb;
}

.result-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.match-table {
  margin-top: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}
</style>
