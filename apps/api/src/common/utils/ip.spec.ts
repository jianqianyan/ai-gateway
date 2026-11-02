import { isIpAllowed, isValidIpEntry, normalizeIp } from './ip';

describe('IP allowlist', () => {
  it('allows everything when the list is empty', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
    expect(isIpAllowed('1.2.3.4', null)).toBe(true);
  });

  it('matches exact IPv4 addresses', () => {
    expect(isIpAllowed('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(isIpAllowed('127.0.0.2', ['127.0.0.1'])).toBe(false);
  });

  it('matches IPv4 CIDR ranges', () => {
    expect(isIpAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('192.168.1.1', ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('192.168.1.1', ['192.168.0.0/16'])).toBe(true);
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(isIpAllowed('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
  });

  it('supports IPv6 exact match and CIDR', () => {
    expect(isIpAllowed('2001:db8::1', ['2001:db8::1'])).toBe(true);
    expect(isIpAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(isIpAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
  });

  it('rejects invalid allowlist entries and invalid client IPs', () => {
    expect(isValidIpEntry('10.0.0.0/8')).toBe(true);
    expect(isValidIpEntry('not-an-ip')).toBe(false);
    expect(isIpAllowed('not-an-ip', ['10.0.0.0/8'])).toBe(false);
  });
});
