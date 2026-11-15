/** Parse une durée utilisateur : "5s", "2m", "1h", "3d" ou millisecondes brutes. */
export function parseDurationMs(raw: string): number | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?|d|days?)$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith('s')) return amount * 1_000;
  if (unit.startsWith('m')) return amount * 60_000;
  if (unit.startsWith('h')) return amount * 3_600_000;
  return amount * 86_400_000;
}
