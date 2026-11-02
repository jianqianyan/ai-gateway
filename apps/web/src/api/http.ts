import axios from 'axios';

export const TOKEN_KEY = 'ag_access_token';
export const USER_KEY = 'ag_user';

export const api: any = axios.create({
  baseURL: '/api/admin',
  withCredentials: true,
  timeout: 60000,
});

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function setStoredUser(user: any) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): any {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearAuthStorage() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || ({} as any);
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post('/api/admin/auth/refresh', {}, { withCredentials: true })
      .then((res) => {
        const data = res.data;
        setToken(data.accessToken);
        setStoredUser(data.user);
        return data.accessToken as string;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const status = error?.response?.status;
    const config = error?.config || {};
    const url = String(config.url || '');
    const canRetry =
      status === 401 &&
      !config.__retried &&
      !url.includes('/auth/login') &&
      !url.includes('/auth/refresh');

    if (canRetry) {
      try {
        const token = await refreshAccessToken();
        config.__retried = true;
        config.headers = config.headers || ({} as any);
        (config.headers as any).Authorization = `Bearer ${token}`;
        return api.request(config);
      } catch {
        clearAuthStorage();
        if (!location.pathname.startsWith('/login')) {
          location.href = '/login';
        }
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(error: any): string {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error?.message ||
    error?.message ||
    '请求失败'
  );
}

export async function downloadWithAuth(path: string, params: Record<string, any>, filename: string) {
  const response = await api.get(path, { params, responseType: 'blob' });
  const blob = new Blob([response as any], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
