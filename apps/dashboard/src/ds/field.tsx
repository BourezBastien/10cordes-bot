import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/*
 * CHAMPS. Hauteur de cible 44 px, fond de champ, filet de 2 px qui passe à
 * l'accent au focus. `Field` relie l'étiquette, l'aide et l'erreur au
 * contrôle par un identifiant : elle remet au contrôle, par une fonction
 * d'enfant, les propriétés à répandre (id, aria-describedby, aria-invalid).
 * Une clé se saisit dans `SecretInput`, toujours masquée : rien ne la
 * révèle, ni sur l'écran ni dans le DOM.
 */

const CONTROL =
  'w-full border-2 border-line bg-field px-3 text-sm text-ink placeholder:text-ink-faint/70 read-only:text-ink-soft disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger hover:border-edge focus-visible:border-accent';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(CONTROL, 'h-11', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(CONTROL, 'resize-y py-2.5 leading-relaxed', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

/** Champ de clé API : mot de passe, jamais rempli automatiquement. */
export const SecretInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <Input
    ref={ref}
    type="password"
    autoComplete="off"
    autoCapitalize="off"
    spellCheck={false}
    data-lpignore="true"
    {...props}
  />
));
SecretInput.displayName = 'SecretInput';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Marque l'étiquette d'un astérisque ; le contrôle reste maître de l'exigence. */
  required?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, hint, error, required = false, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-label">
        {label}
        {required ? (
          <span aria-hidden className="text-accent">
            {' *'}
          </span>
        ) : null}
      </label>
      {children({
        id,
        'aria-describedby': error ? errorId : hint ? hintId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger-soft">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({ className, label, ...props }, ref) => (
  <label
    className={cn(
      'flex min-h-11 cursor-pointer items-center gap-3 text-sm select-none has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
      className,
    )}
  >
    <input ref={ref} type="checkbox" className="sr-only" {...props} />
    <span
      aria-hidden
      className={cn(
        'grid h-4 w-4 shrink-0 place-items-center border-2 border-edge bg-field',
        'before:h-1.5 before:w-1.5 before:bg-accent-ink before:opacity-0 before:content-[""]',
        'peer-checked:border-accent peer-checked:bg-accent peer-checked:before:opacity-100',
        'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
      )}
    />
    {label}
  </label>
));
Checkbox.displayName = 'Checkbox';

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type' | 'children'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Nom lu par un écran. */
  label: string;
}

export function Toggle({ checked, onCheckedChange, label, className, disabled, ...props }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        // Éteint : filet et fond de champ, curseur gris. Allumé : plein accent, curseur sombre à droite.
        // La zone d'appui s'étend au-delà du dessin (44 px de haut) sans en changer l'emprise.
        'relative h-6 w-11 shrink-0 border-2 border-edge bg-field disabled:cursor-not-allowed disabled:opacity-50',
        'before:absolute before:-inset-x-1.5 before:-inset-y-2.5 before:content-[""]',
        'aria-checked:border-accent aria-checked:bg-accent enabled:active:translate-y-px',
        className,
      )}
      {...props}
    >
      <span aria-hidden className={cn('absolute top-0.5 left-0.5 h-3.5 w-3.5 bg-ink-faint', checked && 'translate-x-5 bg-accent-ink')} />
    </button>
  );
}
