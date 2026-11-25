import { useEffect, useState } from 'react';

/** L'heure courante, rafraîchie toutes les `intervalMs`. 0 la fige à l'instant du rendu. */
export function useNow(intervalMs = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
