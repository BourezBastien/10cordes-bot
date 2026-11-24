/**
 * Adresses qu'un serveur ne doit jamais joindre pour le compte d'un tiers :
 * locales, privées ou réservées (RFC 1918, boucle, lien local, documentation,
 * multidiffusion). Lecture pure ; la résolution DNS vit dans safe-fetch.
 */

/** Plages IPv4 à refuser, en CIDR. */
const IPV4_CIDR: ReadonlyArray<readonly [base: string, bits: number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** Plages IPv4 en (base masquée, masque). */
const IPV4_RANGES: ReadonlyArray<readonly [base: number, mask: number]> = IPV4_CIDR.map(([base, bits]) => {
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return [((ipv4Number(base) ?? 0) & mask) >>> 0, mask] as const;
});

/** Adresse IPv4 en entier non signé, null si ce n'en est pas une. */
function ipv4Number(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Adresse IPv6 en entier de 128 bits (forme avec ou sans `::`, avec ou sans fin IPv4), null si illisible. */
function ipv6BigInt(address: string): bigint | null {
  let text = address;
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    const embedded = ipv4Number(text.slice(cut + 1));
    if (embedded === null) return null;
    text = `${text.slice(0, cut)}:${(embedded >>> 16).toString(16)}:${(embedded & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 2 ? missing < 1 : missing !== 0)) return null;
  const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

const IPV6_BITS = 128n;

/** L'adresse IPv6 tombe-t-elle dans le préfixe donné ? */
function inV6Prefix(value: bigint, base: string, bits: number): boolean {
  const range = ipv6BigInt(base);
  if (range === null) return false;
  const shift = IPV6_BITS - BigInt(bits);
  return value >> shift === range >> shift;
}

/** Les 32 bits de poids faible d'une adresse IPv6, comme entier IPv4. */
const embeddedV4 = (value: bigint): number => Number(value & 0xffffffffn);

function isPrivateV4(value: number): boolean {
  return IPV4_RANGES.some(([base, mask]) => (value & mask) >>> 0 === base);
}

function isPrivateV6(value: bigint): boolean {
  // Non spécifiée et boucle.
  if (value === 0n || value === 1n) return true;
  // Adresses transportant une IPv4 : elle décide.
  if (inV6Prefix(value, '::ffff:0.0.0.0', 96) || inV6Prefix(value, '64:ff9b::', 96)) return isPrivateV4(embeddedV4(value));
  if (inV6Prefix(value, '2002::', 16)) return isPrivateV4(Number((value >> 80n) & 0xffffffffn));
  return (
    inV6Prefix(value, '64:ff9b:1::', 48) ||
    inV6Prefix(value, '100::', 64) ||
    inV6Prefix(value, '2001::', 32) ||
    inV6Prefix(value, '2001:2::', 48) ||
    inV6Prefix(value, '2001:10::', 28) ||
    inV6Prefix(value, '2001:20::', 28) ||
    inV6Prefix(value, '2001:db8::', 32) ||
    inV6Prefix(value, 'fc00::', 7) ||
    inV6Prefix(value, 'fe80::', 10) ||
    inV6Prefix(value, 'ff00::', 8)
  );
}

/**
 * L'adresse est-elle locale, privée ou réservée ? Accepte les crochets d'une
 * IPv6 littérale et l'indice de zone (`fe80::1%eth0`). Une adresse illisible
 * est refusée : la porte se ferme, elle ne s'ouvre pas.
 */
export function isPrivateAddress(address: string): boolean {
  const candidate = address.replace(/^\[|\]$/gu, '').replace(/%[^\s]+$/u, '').toLowerCase();
  const v4 = ipv4Number(candidate);
  if (v4 !== null) return isPrivateV4(v4);
  const v6 = ipv6BigInt(candidate);
  return v6 === null || isPrivateV6(v6);
}
