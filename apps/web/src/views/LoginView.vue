<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Lock, User } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { apiErrorMessage } from '../api/http';

const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const form = reactive({ username: 'admin', password: 'Admin@123456' });

async function login() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    ElMessage.success('登录成功');
    router.push('/dashboard');
  } catch (e: any) {
    ElMessage.error(apiErrorMessage(e));
  } finally {
    loading.value = false;
  }
}

function useAccount(username: string, password: string) {
  form.username = username;
  form.password = password;
}
</script>

<template>
  <div class="login-page">
    <div class="login-panel">
      <div class="login-intro">
        <div class="logo-row">
          <div class="logo-mark">AG</div>
          <span>AI Gateway</span>
        </div>
        <h1>一个入口，<br />连接所有大模型。</h1>
        <p class="intro-text">
          统一接入 OpenAI、Anthropic、Gemini 与兼容协议；按 Key 分发模型权限、频率和配额；
          输入输出双向敏感拦截，所有调用可追溯。
        </p>
        <div class="feature-list">
          <div><span>01</span> 多上游与自动故障转移</div>
          <div><span>02</span> Key 级模型 / IP / 频次 / 配额</div>
          <div><span>03</span> 输入与输出敏感信息拦截</div>
          <div><span>04</span> 调用日志、Token 与成本统计</div>
        </div>
        <div class="intro-footer">NestJS · MySQL · Redis · Vue 3 · Element Plus X</div>
      </div>

      <div class="login-card">
        <div class="card-heading">
          <h2>登录控制台</h2>
          <p>使用管理员或只读账号进入</p>
        </div>

        <el-form @submit.prevent="login">
          <el-form-item>
            <el-input v-model="form.username" size="large" placeholder="用户名" :prefix-icon="User" />
          </el-form-item>
          <el-form-item>
            <el-input
              v-model="form.password"
              size="large"
              type="password"
              show-password
              placeholder="密码"
              :prefix-icon="Lock"
              @keyup.enter="login"
            />
          </el-form-item>
          <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="login">
            进入控制台
          </el-button>
        </el-form>

        <div class="demo-box">
          <div class="demo-title">演示账号</div>
          <button class="demo-item" type="button" @click="useAccount('admin', 'Admin@123456')">
            <span>管理员</span>
            <code>admin / Admin@123456</code>
          </button>
          <button class="demo-item" type="button" @click="useAccount('viewer', 'Viewer@123456')">
            <span>只读用户</span>
            <code>viewer / Viewer@123456</code>
          </button>
        </div>

        <div class="login-note">首次部署后请立即修改默认密码。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 12% 18%, rgba(56, 189, 248, 0.14), transparent 30%),
    radial-gradient(circle at 85% 80%, rgba(99, 102, 241, 0.16), transparent 32%),
    #08101d;
  padding: 32px;
}

.login-panel {
  width: min(1080px, 100%);
  min-height: 620px;
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
}

.login-intro {
  position: relative;
  padding: 52px 54px;
  color: #e7eefc;
  background:
    linear-gradient(160deg, rgba(15, 30, 52, 0.92), rgba(8, 16, 29, 0.98)),
    url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><path d="M0 80h160M80 0v160" stroke="%231e3a5f" stroke-width="0.5"/></svg>');
}

.logo-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.logo-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-weight: 800;
  background: linear-gradient(135deg, #38bdf8, #6366f1);
}

.login-intro h1 {
  font-size: 43px;
  line-height: 1.16;
  letter-spacing: -0.04em;
  margin: 62px 0 18px;
}

.intro-text {
  color: #9fb2cd;
  font-size: 14px;
  line-height: 1.9;
  max-width: 470px;
}

.feature-list {
  margin-top: 42px;
  display: grid;
  gap: 14px;
  font-size: 13px;
  color: #c2d1e6;
}

.feature-list div {
  display: flex;
  align-items: center;
  gap: 12px;
}

.feature-list span {
  color: #38bdf8;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
}

.intro-footer {
  position: absolute;
  bottom: 34px;
  font-size: 11px;
  color: #637897;
}

.login-card {
  background: #ffffff;
  padding: 64px 52px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.card-heading h2 {
  margin: 0;
  font-size: 26px;
  letter-spacing: -0.03em;
  color: #0f172a;
}

.card-heading p {
  margin: 9px 0 32px;
  color: #6b7280;
  font-size: 13px;
}

.login-btn {
  width: 100%;
  margin-top: 4px;
  height: 44px;
  font-weight: 600;
}

.demo-box {
  margin-top: 30px;
  padding-top: 22px;
  border-top: 1px solid #eef1f6;
}

.demo-title {
  font-size: 11px;
  color: #8a94a6;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.demo-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #475569;
  font-size: 12px;
}

.demo-item:hover code {
  color: #2563eb;
}

.demo-item code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #64748b;
  background: #f4f6fa;
  padding: 4px 8px;
  border-radius: 6px;
}

.login-note {
  margin-top: 26px;
  color: #9aa4b2;
  font-size: 11px;
}

@media (max-width: 900px) {
  .login-panel {
    grid-template-columns: 1fr;
  }
  .login-intro {
    display: none;
  }
}
</style>
