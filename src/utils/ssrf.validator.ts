import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from './errors.js';

function parseIpv6MappedIpv4(normalizedIpv6: string): string | null {
  const prefix = normalizedIpv6.startsWith('::ffff:')
    ? '::ffff:'
    : normalizedIpv6.startsWith('0:0:0:0:0:ffff:')
      ? '0:0:0:0:0:ffff:'
      : null;

  if (!prefix) return null;
  const rest = normalizedIpv6.slice(prefix.length);

  if (net.isIPv4(rest)) {
    return rest;
  }

  // Handle hex form produced by URL parser, e.g. "7f00:1" or "c0a8:101"
  const hexParts = rest.split(':');
  if (hexParts.length === 2) {
    const hi = parseInt(hexParts[0], 16);
    const lo = parseInt(hexParts[1], 16);
    if (!Number.isNaN(hi) && !Number.isNaN(lo) && hi >= 0 && hi <= 0xffff && lo >= 0 && lo <= 0xffff) {
      const b0 = (hi >> 8) & 0xff;
      const b1 = hi & 0xff;
      const b2 = (lo >> 8) & 0xff;
      const b3 = lo & 0xff;
      return `${b0}.${b1}.${b2}.${b3}`;
    }
  }

  return null;
}

export function isPrivateIp(ip: string): boolean {
  const cleanIp = ip.trim().replace(/^\[|\]$/g, '');

  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [b0, b1, b2] = parts;

    // 0.0.0.0/8 (Current network / unspecified)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (Private)
    if (b0 === 10) return true;
    // 100.64.0.0/10 (Carrier-grade NAT / Shared Address Space)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (Private)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments) & 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && (b2 === 0 || b2 === 2)) return true;
    // 192.168.0.0/16 (Private)
    if (b0 === 192 && b1 === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2) & 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast)
    if (b0 >= 224) return true;

    return false;
  }

  if (net.isIPv6(cleanIp)) {
    const normalized = cleanIp.toLowerCase();
    // Loopback
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || normalized === '0000:0000:0000:0000:0000:0000:0000:0001') {
      return true;
    }
    // Unspecified
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0' || normalized === '0000:0000:0000:0000:0000:0000:0000:0000') {
      return true;
    }
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
    const mappedV4 = parseIpv6MappedIpv4(normalized);
    if (mappedV4 !== null) {
      return isPrivateIp(mappedV4);
    }
    if (normalized.startsWith('::ffff:') || normalized.startsWith('0:0:0:0:0:ffff:')) {
      return true;
    }
    // NAT64 well-known prefix (64:ff9b::/96) & 6to4 (2002::/16) & Teredo (2001::/32)
    if (normalized.startsWith('64:ff9b:') || normalized.startsWith('2002:') || normalized.startsWith('2001:0:') || normalized.startsWith('2001::') || normalized.startsWith('2001:db8:')) {
      return true;
    }
    // Link-local: fe80::/10
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true;
    }
    // Unique local address: fc00::/7
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    // Multicast: ff00::/8
    if (normalized.startsWith('ff')) {
      return true;
    }

    return false;
  }

  return true;
}

export async function validateSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError('INVALID_URL', `Malformed URL provided: "${rawUrl}"`, 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('UNSUPPORTED_PROTOCOL', `Only http and https protocols are supported, got "${parsed.protocol}"`, 400);
  }

  if (parsed.username || parsed.password) {
    throw new AppError('INVALID_URL', 'URLs with embedded credentials are not allowed.', 400);
  }

  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.replace(/^\[|\]$/g, '');

  // Obvious localhost/meta hostnames
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname === '169.254.169.254'
  ) {
    throw new AppError('SSRF_FORBIDDEN_TARGET', `Access to private/internal host "${rawHostname}" is blocked`, 403);
  }

  // If hostname is directly an IP (IPv4 or unbracketed IPv6)
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new AppError('SSRF_FORBIDDEN_TARGET', `Access to private/internal IP address "${rawHostname}" is blocked`, 403);
    }
    return parsed;
  }

  // Resolve hostname DNS to check resolved IP addresses
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      throw new AppError('DNS_LOOKUP_FAILED', `Unable to resolve host "${hostname}"`, 400);
    }
    for (const record of records) {
      if (isPrivateIp(record.address)) {
        throw new AppError(
          'SSRF_FORBIDDEN_TARGET',
          `Host "${hostname}" resolved to blocked private/internal IP "${record.address}"`,
          403
        );
      }
    }
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    throw new AppError('DNS_LOOKUP_FAILED', `Unable to resolve host "${hostname}"`, 400);
  }

  return parsed;
}
