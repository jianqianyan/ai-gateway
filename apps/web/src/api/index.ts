import { api, downloadWithAuth } from './http';

export const authApi = {
  login: (body: { username: string; password: string }) => api.post('/auth/login', body),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.put('/auth/password', body),
};

export const statsApi = {
  overview: (range: string) => api.get('/stats/overview', { params: { range } }),
  timeseries: (range: string) => api.get('/stats/timeseries', { params: { range } }),
  top: (range: string) => api.get('/stats/top', { params: { range } }),
  recent: () => api.get('/stats/recent'),
};

export const providersApi = {
  list: () => api.get('/providers'),
  get: (id: string) => api.get(`/providers/${id}`),
  create: (body: any) => api.post('/providers', body),
  update: (id: string, body: any) => api.patch(`/providers/${id}`, body),
  remove: (id: string) => api.delete(`/providers/${id}`),
  test: (id: string, body: any = {}) => api.post(`/providers/${id}/test`, body),
  syncModels: (id: string) => api.post(`/providers/${id}/sync-models`),
  addModel: (id: string, body: any) => api.post(`/providers/${id}/models`, body),
  updateModel: (id: string, modelId: string, body: any) =>
    api.patch(`/providers/${id}/models/${modelId}`, body),
  removeModel: (id: string, modelId: string) => api.delete(`/providers/${id}/models/${modelId}`),
  allModels: () => api.get('/provider-models'),
};

export const modelsApi = {
  list: () => api.get('/models'),
  get: (id: string) => api.get(`/models/${id}`),
  create: (body: any) => api.post('/models', body),
  update: (id: string, body: any) => api.patch(`/models/${id}`, body),
  remove: (id: string) => api.delete(`/models/${id}`),
  addRoute: (id: string, body: any) => api.post(`/models/${id}/routes`, body),
  updateRoute: (id: string, routeId: string, body: any) =>
    api.patch(`/models/${id}/routes/${routeId}`, body),
  removeRoute: (id: string, routeId: string) => api.delete(`/models/${id}/routes/${routeId}`),
};

export const keysApi = {
  list: () => api.get('/keys'),
  get: (id: string) => api.get(`/keys/${id}`),
  create: (body: any) => api.post('/keys', body),
  update: (id: string, body: any) => api.patch(`/keys/${id}`, body),
  remove: (id: string) => api.delete(`/keys/${id}`),
  rotate: (id: string) => api.post(`/keys/${id}/rotate`),
  revoke: (id: string) => api.post(`/keys/${id}/revoke`),
  disable: (id: string) => api.post(`/keys/${id}/disable`),
  enable: (id: string) => api.post(`/keys/${id}/enable`),
  usage: (id: string) => api.get(`/keys/${id}/usage`),
};

export const logsApi = {
  list: (params: any) => api.get('/logs', { params }),
  detail: (id: string) => api.get(`/logs/${id}`),
  exportCsv: (params: any) =>
    downloadWithAuth('/logs/export', params, `ai-gateway-logs-${Date.now()}.csv`),
};

export const sensitiveApi = {
  rules: () => api.get('/sensitive/rules'),
  createRule: (body: any) => api.post('/sensitive/rules', body),
  updateRule: (id: string, body: any) => api.patch(`/sensitive/rules/${id}`, body),
  removeRule: (id: string) => api.delete(`/sensitive/rules/${id}`),
  policies: () => api.get('/sensitive/policies'),
  policy: (id: string) => api.get(`/sensitive/policies/${id}`),
  createPolicy: (body: any) => api.post('/sensitive/policies', body),
  updatePolicy: (id: string, body: any) => api.patch(`/sensitive/policies/${id}`, body),
  setDefault: (id: string) => api.post(`/sensitive/policies/${id}/default`),
  removePolicy: (id: string) => api.delete(`/sensitive/policies/${id}`),
  test: (body: any) => api.post('/sensitive/test', body),
};

export const usersApi = {
  list: () => api.get('/users'),
  create: (body: any) => api.post('/users', body),
  update: (id: string, body: any) => api.patch(`/users/${id}`, body),
  remove: (id: string) => api.delete(`/users/${id}`),
};

export const settingsApi = {
  get: () => api.get('/settings'),
  update: (body: any) => api.put('/settings', body),
};

export const auditApi = {
  list: (params: any) => api.get('/audit-logs', { params }),
};
