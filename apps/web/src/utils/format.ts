import dayjs from 'dayjs';

export function formatDate(value: any, withSeconds = true) {
  if (!value) return '-';
  return dayjs(value).format(withSeconds ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm');
}

export function formatNumber(value: any) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('zh-CN');
}

export function formatCost(value: any) {
  const n = Number(value || 0);
  if (!n) return '¥0.000000';
  return `¥${n.toFixed(6)}`;
}

export function shortId(value?: string, head = 10, tail = 4) {
  if (!value) return '-';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export const statusLabels: Record<string, string> = {
  SUCCESS: '成功',
  ERROR: '失败',
  BLOCKED: '已拦截',
  CANCELLED: '已取消',
  ACTIVE: '启用',
  DISABLED: '禁用',
  REVOKED: '已吊销',
  UNKNOWN: '未知',
  HEALTHY: '健康',
  DEGRADED: '降级',
  DOWN: '不可用',
  ADMIN: '管理员',
  VIEWER: '只读用户',
};

export function statusType(status: string) {
  if (['SUCCESS', 'ACTIVE', 'HEALTHY'].includes(status)) return 'success';
  if (['ERROR', 'DOWN', 'REVOKED'].includes(status)) return 'danger';
  if (['BLOCKED', 'DEGRADED', 'DISABLED'].includes(status)) return 'warning';
  return 'info';
}

export const providerTypeLabels: Record<string, string> = {
  OPENAI: 'OpenAI Compatible',
  ANTHROPIC: 'Anthropic Messages',
  GEMINI: 'Google Gemini',
  AZURE_OPENAI: 'Azure OpenAI',
};

export const actionLabels: Record<string, string> = {
  BLOCK: '阻断',
  MASK: '脱敏',
  LOG: '仅记录',
};

export const directionLabels: Record<string, string> = {
  INPUT: '输入',
  OUTPUT: '输出',
  BOTH: '双向',
};

export const ruleTypeLabels: Record<string, string> = {
  KEYWORD: '关键词',
  REGEX: '正则',
  BUILTIN: '内置规则',
};

export function actionType(action: string) {
  if (action === 'BLOCK') return 'danger';
  if (action === 'MASK') return 'warning';
  return 'info';
}

export function jsonPretty(value: any) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
