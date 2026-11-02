import { defineStore } from 'pinia';
import { authApi } from '../api';
import {
  clearAuthStorage,
  getStoredUser,
  getToken,
  setStoredUser,
  setToken,
} from '../api/http';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    user: getStoredUser(),
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.token),
    isAdmin: (state) => state.user?.role === 'ADMIN',
    role: (state) => state.user?.role || 'VIEWER',
  },
  actions: {
    async login(username: string, password: string) {
      const data = await authApi.login({ username, password });
      this.token = data.accessToken;
      this.user = data.user;
      setToken(data.accessToken);
      setStoredUser(data.user);
      return data;
    },
    async fetchMe() {
      if (!this.token) return null;
      try {
        const user = await authApi.me();
        this.user = user;
        setStoredUser(user);
        return user;
      } catch (e) {
        this.clear();
        throw e;
      }
    },
    async logout() {
      try {
        await authApi.logout();
      } catch {
        // ignore
      }
      this.clear();
    },
    clear() {
      this.token = '';
      this.user = null;
      clearAuthStorage();
    },
    setSession(token: string, user: any) {
      this.token = token;
      this.user = user;
      setToken(token);
      setStoredUser(user);
    },
  },
});
