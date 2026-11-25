import { cn } from '@/lib/utils';

/*
 * MARQUE. Le sceau 10cordes (cadre orange, deux barres) en pixels nets,
 * suivi du nom en police d'affichage. Le favicon porte le même dessin.
 */

export function BrandMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
      className={cn('shrink-0', className)}
    >
      <rect width="16" height="16" fill="var(--color-bg)" />
      <rect x="2" y="2" width="12" height="2" fill="var(--color-accent)" />
      <rect x="2" y="12" width="12" height="2" fill="var(--color-accent)" />
      <rect x="2" y="4" width="2" height="8" fill="var(--color-accent)" />
      <rect x="12" y="4" width="2" height="8" fill="var(--color-accent)" />
      <rect x="5" y="5" width="2" height="6" fill="var(--color-ink)" />
      <rect x="9" y="5" width="2" height="6" fill="var(--color-ink)" />
      <rect x="9" y="9" width="2" height="2" fill="var(--color-accent)" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark size={24} />
      <span className="font-pixel text-sm tracking-widest text-ink">10CORDES</span>
    </span>
  );
}
