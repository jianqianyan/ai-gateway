<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { CopyDocument, Check } from '@element-plus/icons-vue';
import { settingsApi } from '../api';
import { apiErrorMessage } from '../api/http';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const isAdmin = computed(() => auth.isAdmin);
const origin = window.location.origin;
const loading = ref(false);
const saving = ref(false);
const form = reactive<any>({
  siteName: 'AI Gateway',
  logRetentionDays: 30,
  bodyRetentionDays: 7,
  requestTimeoutMs: 120000,
  maxBodyBytes: 10485760,
  trustProxy: '1',
  rateLimitFailOpen: true,
  captureBodiesDefault: false,
  timezone: 'Asia/Shanghai',
});

async function load() {
  loading.value = true;
  try {
    Object.assign(form, await settingsApi.get());
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    Object.assign(form, await settingsApi.update(form));
    ElMessage.success('设置已保存');
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success('已复制');
  } catch {
    ElMessage.warning('复制失败');
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">系统设置</h2>
        <p class="page-subtitle">日志保留、超时、代理和限流降级策略</p>
      </div>
      <el-button v-if="isAdmin" type="primary" :icon="Check" :loading="saving" @click="save">保存设置</el-button>
    </div>

    <div class="settings-grid">
      <div class="page-card">
        <div class="section-title">基础配置</div>
        <el-form v-loading="loading" label-width="150px" :disabled="!isAdmin">
          <el-form-item label="站点名称">
            <el-input v-model="form.siteName" />
          </el-form-item>
          <el-form-item label="日志保留天数">
            <el-input-number v-model="form.logRetentionDays" :min="1" :max="3650" style="width: 100%" />
          </el-form-item>
          <el-form-item label="正文保留天数">
            <el-input-number v-model="form.bodyRetentionDays" :min="1" :max="3650" style="width: 100%" />
          </el-form-item>
          <el-form-item label="默认记录正文">
            <el-switch v-model="form.captureBodiesDefault" />
            <span class="tip">仅作为新 Key 的默认值</span>
          </el-form-item>
          <el-form-item label="上游超时 (ms)">
            <el-input-number v-model="form.requestTimeoutMs" :min="1000" :max="600000" :step="1000" style="width: 100%" />
          </el-form-item>
          <el-form-item label="最大 Body (bytes)">
            <el-input-number v-model="form.maxBodyBytes" :min="1024" :step="1024" style="width: 100%" />
          </el-form-item>
          <el-form-item label="Trust Proxy">
            <el-input v-model="form.trustProxy" placeholder="1 或 false" />
            <div class="tip">部署在 Nginx 后建议设为 1，用于正确获取客户端 IP。</div>
          </el-form-item>
          <el-form-item label="限流 Redis 故障">
            <el-radio-group v-model="form.rateLimitFailOpen">
              <el-radio-button :value="true">放行（fail-open）</el-radio-button>
              <el-radio-button :value="false">拒绝（fail-closed）</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="时区">
            <el-input v-model="form.timezone" />
          </el-form-item>
        </el-form>
      </div>

      <div>
        <div class="page-card">
          <div class="section-title">接入信息</div>
          <div class="endpoint">
            <div class="endpoint-label">OpenAI 兼容 Base URL</div>
            <div class="endpoint-value">
              <code>{{ origin }}/v1</code>
              <el-button text :icon="CopyDocument" @click="copy(`${origin}/v1`)" />
            </div>
          </div>
          <div class="endpoint">
            <div class="endpoint-label">对话接口</div>
            <div class="endpoint-value"><code>POST /v1/chat/completions</code></div>
          </div>
          <div class="endpoint">
            <div class="endpoint-label">模型列表</div>
            <div class="endpoint-value"><code>GET /v1/models</code></div>
          </div>
          <div class="endpoint">
            <div class="endpoint-label">鉴权方式</div>
            <div class="endpoint-value"><code>Authorization: Bearer sk-gw-...</code></div>
          </div>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            title="OpenAI SDK 可直接使用"
            description="把 base_url 指向 /v1，api_key 使用网关签发的 Key 即可。"
            class="sdk-alert"
          />
        </div>

        <div class="page-card code-card">
          <div class="section-title">调用示例</div>
          <pre class="code-block">curl {{ origin }}/v1/chat/completions \
  -H "Authorization: Bearer sk-gw-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'</pre>
          <div class="tip">模型名必须是管理端“模型管理”中启用的公共模型名。</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 16px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 16px;
}

.tip {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-left: 8px;
  line-height: 1.6;
}

.endpoint {
  padding: 11px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.endpoint-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 5px;
}

.endpoint-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.endpoint-value code,
.code-block {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
}

.endpoint-value code {
  background: var(--el-fill-color-lighter);
  padding: 4px 7px;
  border-radius: 5px;
  word-break: break-all;
}

.sdk-alert {
  margin-top: 18px;
}

.code-card {
  margin-top: 16px;
}

.code-block {
  margin: 0;
  padding: 14px;
  border-radius: 8px;
  background: #0d1117;
  color: #c9d1d9;
  line-height: 1.7;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
