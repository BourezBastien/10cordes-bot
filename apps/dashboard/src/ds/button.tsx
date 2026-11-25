import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/*
 * BOUTON. Libellé en pixel, quatre hauteurs : 32 (puce), 34 (petit), 44
 * (cible), 48 (primaire). L'appui s'enfonce d'un pixel, sans transition.
 * En chargement, un curseur clignotant suit le libellé et le bouton devient
 * inerte. La zone d'appui d'une puce et d'un petit bouton déborde de son
 * dessin jusqu'à 44 px de haut : l'emprise ne change pas.
 */

const buttonVariants = cva(
  [
    'text-badge inline-flex shrink-0 items-center justify-center gap-2 border-2 whitespace-nowrap select-none',
    'disabled:cursor-not-allowed disabled:opacity-40 enabled:active:translate-y-px',
  ],
  {
    variants: {
      variant: {
        solid: 'border-accent bg-accent text-accent-ink enabled:hover:border-accent-soft enabled:hover:bg-accent-soft',
        outline: 'border-edge bg-panel text-ink enabled:hover:border-ink-faint enabled:hover:bg-hover',
        ghost: 'border-transparent bg-transparent text-ink-soft enabled:hover:bg-hover enabled:hover:text-ink',
        danger: 'border-danger bg-danger text-danger-ink enabled:hover:border-danger-soft enabled:hover:bg-danger-soft',
      },
      size: {
        chip: 'relative h-8 px-3 before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[""]',
        sm: 'relative h-[34px] px-3 before:absolute before:-inset-y-[5px] before:inset-x-0 before:content-[""]',
        md: 'h-11 px-4',
        lg: 'h-12 px-6',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Une demande est en cours : curseur clignotant, bouton inerte. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, type = 'button', children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
      {loading ? <span aria-hidden className="caret" /> : null}
    </button>
  ),
);
Button.displayName = 'Button';
