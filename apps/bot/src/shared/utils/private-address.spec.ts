import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from './private-address';

/**
 * Adresses qu'un serveur ne doit jamais joindre pour le compte d'un tiers.
 * La porte se ferme sur une adresse illisible.
 */

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '127.8.8.8',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.1.1',
    '0.0.0.0',
    '100.64.0.1',
    '100.65.0.1',
    '192.0.2.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:192.0.2.128',
    '64:ff9b::c000:0201',
    '2002:0a00:0001::',
    '100::1',
    '2001::1',
    'pas-une-adresse',
    '999.1.1.1',
    '1.2.3',
  ])('%s : locale, privée ou réservée', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '172.15.255.255',
    '192.169.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '192.0.1.1',
    '2606:4700::6810:84e5',
    '2a01:cb00::1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1',
  ])('%s : publique', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});
