import {
  SensitiveAction,
  SensitiveDirection,
  SensitiveRuleType,
} from '@prisma/client';
import { RuleLike, maxHoldback, scanText, scanTexts } from './matcher';

function rule(overrides: Partial<RuleLike>): RuleLike {
  return {
    id: 'r1',
    name: 'test',
    category: 'test',
    type: SensitiveRuleType.KEYWORD,
    pattern: '',
    action: SensitiveAction.BLOCK,
    direction: SensitiveDirection.BOTH,
    severity: 50,
    replacement: '***',
    builtinKey: null,
    enabled: true,
    ...overrides,
  };
}

describe('sensitive matcher', () => {
  it('matches keywords case-insensitively and ignores zero-width characters', () => {
    const rules = [
      rule({ pattern: '内部机密' }),
      rule({ id: 'r2', pattern: 'secret', action: SensitiveAction.LOG }),
    ];
    const result = scanText('这是内\u200B部机密，SECRET', rules, 'INPUT');
    expect(result.action).toBe('BLOCK');
    expect(result.matches.length).toBe(2);
    expect(result.matches[0].masked).not.toContain('内部机密');
  });

  it('applies direction filters', () => {
    const rules = [rule({ direction: SensitiveDirection.INPUT, pattern: 'input-only' })];
    expect(scanText('input-only', rules, 'INPUT').matches.length).toBe(1);
    expect(scanText('input-only', rules, 'OUTPUT').matches.length).toBe(0);
  });

  it('detects built-in phone numbers and masks them', () => {
    const rules = [
      rule({
        type: SensitiveRuleType.BUILTIN,
        builtinKey: 'cn_phone',
        action: SensitiveAction.MASK,
      }),
    ];
    const result = scanText('联系电话 13800138000', rules, 'INPUT');
    expect(result.action).toBe('MASK');
    expect(result.matches[0].value).toBe('13800138000');
    expect(result.matches[0].masked).toContain('*');
  });

  it('validates Chinese ID checksum before reporting a match', () => {
    const rules = [
      rule({ type: SensitiveRuleType.BUILTIN, builtinKey: 'cn_id_card' }),
    ];
    const valid = scanText('身份证 11010519491231002X', rules, 'INPUT');
    const invalid = scanText('身份证 110105194912310021', rules, 'INPUT');
    expect(valid.matches.length).toBe(1);
    expect(invalid.matches.length).toBe(0);
  });

  it('supports custom regex rules', () => {
    const rules = [
      rule({
        type: SensitiveRuleType.REGEX,
        pattern: 'ORD-\\d{4}',
        action: SensitiveAction.BLOCK,
      }),
    ];
    const result = scanText('订单 ORD-2026 已创建', rules, 'OUTPUT');
    expect(result.action).toBe('BLOCK');
    expect(result.matches[0].value).toBe('ORD-2026');
  });

  it('uses the strongest action when multiple rules hit', () => {
    const rules = [
      rule({ pattern: 'hello', action: SensitiveAction.LOG }),
      rule({ id: 'r2', pattern: 'world', action: SensitiveAction.MASK }),
      rule({ id: 'r3', pattern: 'bad', action: SensitiveAction.BLOCK }),
    ];
    expect(scanText('hello world bad', rules, 'INPUT').action).toBe('BLOCK');
    expect(scanText('hello world', rules, 'INPUT').action).toBe('MASK');
    expect(scanText('hello', rules, 'INPUT').action).toBe('LOG');
  });

  it('scans multiple texts with path information', () => {
    const rules = [rule({ pattern: '内部机密' })];
    const result = scanTexts(
      [
        { path: 'messages[0].content', text: '正常内容' },
        { path: 'messages[1].content', text: '内部机密' },
      ],
      rules,
      'INPUT',
    );
    expect(result.action).toBe('BLOCK');
    expect(result.hits[0].path).toBe('messages[1].content');
  });

  it('computes a safe holdback window', () => {
    expect(maxHoldback([rule({ pattern: '内部机密' })])).toBeGreaterThanOrEqual(64);
  });
});
