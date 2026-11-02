import { SensitiveAction, SensitiveDirection, SensitiveRuleType } from '@prisma/client';

export interface BuiltinRuleDef {
  key: string;
  name: string;
  category: string;
  pattern?: string;
  action: SensitiveAction;
  direction: SensitiveDirection;
  severity: number;
  replacement?: string;
}

export const BUILTIN_RULES: BuiltinRuleDef[] = [
  {
    key: 'cn_id_card',
    name: '中国大陆身份证号',
    category: '个人隐私',
    pattern: '(?<!\\d)[1-9]\\d{5}(?:18|19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx](?!\\d)',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 95,
    replacement: '***',
  },
  {
    key: 'cn_phone',
    name: '中国大陆手机号',
    category: '个人隐私',
    pattern: '(?<!\\d)1[3-9]\\d{9}(?!\\d)',
    action: SensitiveAction.MASK,
    direction: SensitiveDirection.BOTH,
    severity: 70,
    replacement: '***',
  },
  {
    key: 'email',
    name: '电子邮箱',
    category: '个人隐私',
    pattern: '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}',
    action: SensitiveAction.MASK,
    direction: SensitiveDirection.BOTH,
    severity: 55,
    replacement: '***',
  },
  {
    key: 'bank_card',
    name: '银行卡号',
    category: '个人隐私',
    pattern: '(?<!\\d)(?:\\d[ -]?){13,19}(?!\\d)',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 90,
    replacement: '***',
  },
  {
    key: 'jwt_token',
    name: 'JWT Token',
    category: '凭证密钥',
    pattern: 'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 90,
    replacement: '***',
  },
  {
    key: 'openai_key',
    name: 'OpenAI / 兼容平台 API Key',
    category: '凭证密钥',
    pattern: 'sk-(?:proj-)?[A-Za-z0-9_-]{20,}',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 95,
    replacement: '***',
  },
  {
    key: 'anthropic_key',
    name: 'Anthropic API Key',
    category: '凭证密钥',
    pattern: 'sk-ant-[A-Za-z0-9_-]{20,}',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 95,
    replacement: '***',
  },
  {
    key: 'aws_access_key',
    name: 'AWS Access Key',
    category: '凭证密钥',
    pattern: 'AKIA[0-9A-Z]{16}',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 95,
    replacement: '***',
  },
  {
    key: 'github_token',
    name: 'GitHub Token',
    category: '凭证密钥',
    pattern: 'gh[pousr]_[A-Za-z0-9]{36,}',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 95,
    replacement: '***',
  },
  {
    key: 'private_key',
    name: '私钥文件头',
    category: '凭证密钥',
    pattern: '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 100,
    replacement: '***',
  },
];

export const DEMO_KEYWORD_RULE: BuiltinRuleDef = {
  key: 'demo_internal_secret',
  name: '示例敏感词：内部机密',
  category: '自定义',
  pattern: '内部机密',
  action: SensitiveAction.BLOCK,
  direction: SensitiveDirection.BOTH,
  severity: 90,
  replacement: '***',
};

export const BUILTIN_REGEX: Record<string, RegExp> = Object.fromEntries(
  BUILTIN_RULES.map((r) => [r.key, new RegExp(r.pattern, 'gi')]),
);

export function isValidChineseId(value: string): boolean {
  if (!/^[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(value)) {
    return false;
  }
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(value[i]) * weights[i];
  return codes[sum % 11] === value[17].toUpperCase();
}

export function luhnCheck(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isValidBuiltinMatch(key: string, value: string): boolean {
  if (key === 'cn_id_card') return isValidChineseId(value);
  if (key === 'bank_card') return luhnCheck(value);
  return true;
}

export function builtinRuleType(): SensitiveRuleType {
  return SensitiveRuleType.BUILTIN;
}
