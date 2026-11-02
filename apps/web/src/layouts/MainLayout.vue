<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ChatDotRound,
  Connection,
  Cpu,
  DataLine,
  Document,
  Key,
  Moon,
  Setting,
  Sunny,
  Tickets,
  User,
  Warning,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const dark = ref(localStorage.getItem('ag_theme') === 'dark');

const menu = [
  { path: '/dashboard', label: '仪表盘', icon: DataLine },
  { path: '/providers', label: '上游管理', icon: Connection },
  { path: '/models', label: '模型管理', icon: Cpu },
  { path: '/keys', label: 'Key 管理', icon: Key },
  { path: '/logs', label: '调用日志', icon: Document },
  { path: '/sensitive', label: '敏感规则', icon: Warning },
  { path: '/playground', label: '在线调试', icon: ChatDotRound },
  { path: '/users', label: '账号管理', icon: User, roles: ['ADMIN'] },
  { path: '/audit', label: '审计日志', icon: Tickets },
  { path: '/settings', label: '系统设置', icon: Setting },
];

const visibleMenu = computed(() =>
  menu.filter((item) => !item.roles || item.roles.includes(auth.role)),
);

const pageTitle = computed(() => (route.meta.title as string) || 'AI Gateway');

function applyTheme() {
  document.documentElement.classList.toggle('dark', dark.value);
  localStorage.setItem('ag_theme', dark.value ? 'dark' : 'light');
}

function toggleTheme() {
  dark.value = !dark.value;
  applyTheme();
}

async function handleCommand(command: string) {
  if (command === 'logout') {
    await auth.logout();
    router.push('/login');
  }
}

onMounted(applyTheme);
</script>

<template>
  <el-container class="layout">
    <el-aside width="230px" class="sidebar">
      <div class="brand">
        <div class="brand-mark">AG</div>
        <div>
          <div class="brand-name">AI Gateway</div>
          <div class="brand-sub">统一模型接入层</div>
        </div>
      </div>

      <el-menu :default-active="route.path" router class="menu" background-color="transparent" text-color="#c7d2e5" active-text-color="#ffffff">
        <el-menu-item v-for="item in visibleMenu" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-footer">
        <div class="health-dot"></div>
        <span>Gateway Online</span>
      </div>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <h1>{{ pageTitle }}</h1>
          <span class="header-tip">统一接入 · 精细管控 · 全链路留痕</span>
        </div>
        <div class="header-right">
          <el-button circle text @click="toggleTheme" :title="dark ? '切换浅色' : '切换深色'">
            <el-icon><Moon v-if="!dark" /><Sunny v-else /></el-icon>
          </el-button>
          <el-tag size="small" :type="auth.isAdmin ? 'danger' : 'info'" effect="light">
            {{ auth.isAdmin ? '管理员' : '只读用户' }}
          </el-tag>
          <el-dropdown trigger="click" @command="handleCommand">
            <span class="user-entry">
              <el-avatar :size="30">{{ (auth.user?.displayName || auth.user?.username || 'U').slice(0, 1) }}</el-avatar>
              <span class="user-name">{{ auth.user?.displayName || auth.user?.username }}</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>{{ auth.user?.username }}</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 20% 0%, #1d3557 0%, #0d1728 45%, #08101d 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 22px 20px 18px;
  color: #fff;
}

.brand-mark {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-weight: 800;
  letter-spacing: -0.04em;
  background: linear-gradient(135deg, #38bdf8, #6366f1);
  box-shadow: 0 8px 24px rgba(56, 189, 248, 0.25);
}

.brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.brand-sub {
  font-size: 11px;
  color: #8ea3c2;
  margin-top: 3px;
}

.menu {
  border-right: none;
  padding: 4px 12px;
  flex: 1;
}

.menu :deep(.el-menu-item) {
  height: 44px;
  border-radius: 10px;
  margin: 3px 0;
  font-size: 13px;
}

.menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.07) !important;
}

.menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.22), rgba(99, 102, 241, 0.18)) !important;
  box-shadow: inset 3px 0 0 #38bdf8;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 24px 20px;
  color: #7f94b3;
  font-size: 11px;
}

.health-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #34d399;
  box-shadow: 0 0 10px #34d399;
}

.header {
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  padding: 0 26px;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 14px;
}

.header-left h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.header-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.user-entry {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
}

.main {
  padding: 22px 26px 30px;
  overflow: auto;
  background: var(--el-bg-color-page);
}
</style>
