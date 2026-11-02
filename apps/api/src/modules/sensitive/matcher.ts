import { SensitiveAction, SensitiveDirection, SensitiveRuleType } from '@prisma/client';
import { BUILTIN_REGEX, isValidBuiltinMatch } from './builtins';

export interface RuleLike {
  id: string;
  name: string;
  category: string;
  type: SensitiveRuleType;
  pattern: string | null;
  action: SensitiveAction;
  direction: SensitiveDirection;
  severity: number;
  replacement: string | null;
  builtinKey: string | null;
  enabled: boolean;
}

export interface SensitiveMatch {
  ruleId: string;
  ruleName: string;
  category: string;
  action: SensitiveAction;
  severity: number;
  start: number;
  end: number;
  value: string;
  masked: string;
}

export interface ScanResult {
  action: 'NONE' | 'BLOCK' | 'MASK' | 'LOG';
  matches: SensitiveMatch[];
}

const ACTION_RANK: Record<string, number> = { NONE: 0, LOG: 1, MASK: 2, BLOCK: 3 };

function normalizeWithMap(input: string) {
  let text = '';
  const map: { start: number; end: number }[] = [];
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i);
    if (cp === undefined) break;
    const ch = String.fromCodePoint(cp);
    const norm = ch
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');
    for (const c of norm) {
      text += c;
      map.push({ start: i, end: i + ch.length });
    }
    i += ch.length;
  }
  return { text, map };
}

function pushMatch(
  out: SensitiveMatch[],
  rule: RuleLike,
  original: string,
  map: { start: number; end: number }[],
  start: number,
  end: number,
) {
  if (start < 0 || end <= start || end > map.length) return;
  const origStart = map[start].start;
  const origEnd = map[end - 1].end;
  const value = original.slice(origStart, origEnd);
  if (!value) return;
  out.push({
    ruleId: rule.id,
    ruleName: rule.name,
    category: rule.category,
    action: rule.action,
    severity: rule.severity,
    start: origStart,
    end: origEnd,
    value,
    masked: maskValue(value),
  });
}

export function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  if (value.length <= 8) return value.slice(0, 1) + '*'.repeat(value.length - 2) + value.slice(-1);
  return value.slice(0, 3) + '*'.repeat(Math.min(12, value.length - 6)) + value.slice(-3);
}

export function scanText(
  original: string,
  rules: RuleLike[],
  direction: 'INPUT' | 'OUTPUT',
  maxMatches = 200,
): ScanResult {
  if (!original || !rules?.length) return { action: 'NONE', matches: [] };
  const { text, map } = normalizeWithMap(original);
  const matches: SensitiveMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.direction !== SensitiveDirection.BOTH && rule.direction !== direction) continue;
    if (matches.length >= maxMatches) break;

    if (rule.type === SensitiveRuleType.KEYWORD) {
      const keyword = (rule.pattern || '').toLowerCase();
      if (!keyword) continue;
      let from = 0;
      while (matches.length < maxMatches) {
        const idx = text.indexOf(keyword, from);
        if (idx < 0) break;
        pushMatch(matches, rule, original, map, idx, idx + keyword.length);
        from = idx + Math.max(1, keyword.length);
      }
    } else if (rule.type === SensitiveRuleType.BUILTIN) {
      const regex = rule.builtinKey ? BUILTIN_REGEX[rule.builtinKey] : null;
      if (!regex) continue;
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while (matches.length < maxMatches && (m = regex.exec(text))) {
        if (m[0] && isValidBuiltinMatch(rule.builtinKey || '', m[0])) {
          pushMatch(matches, rule, original, map, m.index, m.index + m[0].length);
        }
        if (m[0].length === 0) regex.lastIndex += 1;
      }
    } else if (rule.type === SensitiveRuleType.REGEX && rule.pattern) {
      try {
        const regex = new RegExp(rule.pattern, 'gi');
        let m: RegExpExecArray | null;
        while (matches.length < maxMatches && (m = regex.exec(text))) {
          if (m[0]) pushMatch(matches, rule, original, map, m.index, m.index + m[0].length);
          if (m[0].length === 0) regex.lastIndex += 1;
        }
      } catch {
        // invalid regex should have been blocked when saving
      }
    }
  }

  const seen = new Set<string>();
  const deduped = matches.filter((m) => {
    const key = `${m.ruleId}:${m.start}:${m.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let action: ScanResult['action'] = 'NONE';
  for (const m of deduped) {
    if (ACTION_RANK[m.action] > ACTION_RANK[action]) action = m.action;
  }
  deduped.sort((a, b) => a.start - b.start || b.severity - a.severity);
  return { action, matches: deduped };
}

export function scanTexts(
  texts: { path: string; text: string }[],
  rules: RuleLike[],
  direction: 'INPUT' | 'OUTPUT',
): ScanResult & { hits: { path: string; match: SensitiveMatch }[] } {
  const all: SensitiveMatch[] = [];
  const hits: { path: string; match: SensitiveMatch }[] = [];
  for (const item of texts) {
    const result = scanText(item.text, rules, direction);
    for (const m of result.matches) {
      all.push(m);
      hits.push({ path: item.path, match: m });
    }
  }
  let action: ScanResult['action'] = 'NONE';
  for (const m of all) {
    if (ACTION_RANK[m.action] > ACTION_RANK[action]) action = m.action;
  }
  all.sort((a, b) => b.severity - a.severity);
  return { action, matches: all, hits };
}

export function applyMask(text: string, matches: SensitiveMatch[], replacement = '***'): string {
  if (!matches.length) return text;
  let out = text;
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  for (const m of sorted) {
    if (m.start < 0 || m.end > out.length) continue;
    out = out.slice(0, m.start) + (m.action === SensitiveAction.MASK ? replacement : replacement) + out.slice(m.end);
  }
  return out;
}

export function maxHoldback(rules: RuleLike[]): number {
  let max = 64;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.type === SensitiveRuleType.KEYWORD) {
      max = Math.max(max, (rule.pattern || '').length + 16);
    } else {
      max = Math.max(max, 96);
    }
  }
  return Math.min(512, max);
}
