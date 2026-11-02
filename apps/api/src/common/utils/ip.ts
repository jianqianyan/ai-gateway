import ipaddr from 'ipaddr.js';

export function normalizeIp(input?: string | null): string {
  if (!input) return '';
  let ip = String(input).trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  try {
    const parsed = ipaddr.parse(ip);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address().toString();
    }
    return parsed.toString();
  } catch {
    return ip;
  }
}

export function isIpAllowed(clientIp: string, allowlist?: unknown): boolean {
  const list = Array.isArray(allowlist) ? allowlist.map(String).filter(Boolean) : [];
  if (list.length === 0) return true;
  const normalized = normalizeIp(clientIp);
  if (!normalized) return false;

  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(normalized) as ipaddr.IPv4 | ipaddr.IPv6;
  } catch {
    return false;
  }

  for (const entry of list) {
    try {
      if (entry.includes('/')) {
        const [network, bits] = ipaddr.parseCIDR(entry.trim());
        if (addr.kind() === network.kind() && addr.match(network, bits)) {
          return true;
        }
      } else if (normalizeIp(entry) === normalized) {
        return true;
      }
    } catch {
      // ignore invalid entry and try the next one
    }
  }
  return false;
}

export function isValidIpEntry(entry: string): boolean {
  try {
    if (entry.includes('/')) {
      ipaddr.parseCIDR(entry.trim());
    } else {
      ipaddr.parse(entry.trim());
    }
    return true;
  } catch {
    return false;
  }
}
