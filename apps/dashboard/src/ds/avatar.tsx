import { useState } from 'react';
import { cn } from '@/lib/utils';

/*
 * AVATAR. Un carré : l'icône du serveur ou, à défaut (icône absente, image
 * refusée par la politique de sécurité), l'initiale du nom. Jamais de cercle.
 */

export interface AvatarProps {
  name: string;
  /** URL complète de l'icône (https://cdn.discordapp.com/...), ou rien. */
  src?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ name, src, size = 40, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  const showImage = Boolean(src) && !failed;
  return (
    <span
      role="img"
      aria-label={name}
      className={cn('notched inline-grid shrink-0 place-items-center overflow-hidden bg-accent-deep', className)}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden className="font-pixel text-accent" style={{ fontSize: Math.round(size * 0.45) }}>
          {letter}
        </span>
      )}
    </span>
  );
}
