import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from './errors.js';

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) {
      return true;
    }

    const [b0, b1] = parts;

    // 0.0.0.0/8
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (Private)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (Private)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (b0 === 169 && b1 === 254) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (b0 >= 224) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // Loopback
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (normalized.startsWith('::ffff:')) {
      const v4part = normalized.replace('::ffff:', '');
      if (net.isIPv4(v4part)) {
        return isPrivateIp(v4part);
      }
    }
    // Link-local: fe80::/10
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true;
    }
    // Unique local address: fc00::/7
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
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

  const hostname = parsed.hostname.toLowerCase();

  // Obvious localhost/meta hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname === '169.254.169.254'
  ) {
    throw new AppError('SSRF_FORBIDDEN_TARGET', `Access to private/internal host "${hostname}" is blocked`, 403);
  }

  // If hostname is directly an IP
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new AppError('SSRF_FORBIDDEN_TARGET', `Access to private/internal IP address "${hostname}" is blocked`, 403);
    }
    return parsed;
  }

  // Resolve hostname DNS to check resolved IP addresses
  try {
    const records = await dns.lookup(hostname, { all: true });
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
