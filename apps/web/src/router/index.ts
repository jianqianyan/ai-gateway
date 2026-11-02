import { createRouter, createWebHistory } from 'vue-router';
import MainLayout from '../layouts/MainLayout.vue';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { title: '登录', public: true },
    },
    {
      path: '/',
      component: MainLayout,
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('../views/DashboardView.vue'),
          meta: { title: '仪表盘' },
        },
        {
          path: 'providers',
          name: 'providers',
          component: () => import('../views/ProvidersView.vue'),
          meta: { title: '上游管理' },
        },
        {
          path: 'models',
          name: 'models',
          component: () => import('../views/ModelsView.vue'),
          meta: { title: '模型管理' },
        },
        {
          path: 'keys',
          name: 'keys',
          component: () => import('../views/KeysView.vue'),
          meta: { title: 'Key 管理' },
        },
        {
          path: 'logs',
          name: 'logs',
          component: () => import('../views/LogsView.vue'),
          meta: { title: '调用日志' },
        },
        {
          path: 'sensitive',
          name: 'sensitive',
          component: () => import('../views/SensitiveView.vue'),
          meta: { title: '敏感规则' },
        },
        {
          path: 'playground',
          name: 'playground',
          component: () => import('../views/PlaygroundView.vue'),
          meta: { title: '在线调试' },
        },
        {
          path: 'users',
          name: 'users',
          component: () => import('../views/UsersView.vue'),
          meta: { title: '账号管理', roles: ['ADMIN'] },
        },
        {
          path: 'audit',
          name: 'audit',
          component: () => import('../views/AuditView.vue'),
          meta: { title: '审计日志' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('../views/SettingsView.vue'),
          meta: { title: '系统设置' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    if (to.path === '/login' && auth.token) return '/dashboard';
    return true;
  }
  if (!auth.token) return { path: '/login', query: { redirect: to.fullPath } };
  if (!auth.user) {
    try {
      await auth.fetchMe();
    } catch {
      return { path: '/login', query: { redirect: to.fullPath } };
    }
  }
  const roles = to.meta.roles as string[] | undefined;
  if (roles && !roles.includes(auth.user?.role)) return '/dashboard';
  return true;
});

router.afterEach((to) => {
  document.title = `${to.meta.title || 'AI Gateway'} · AI Gateway`;
});

export default router;
