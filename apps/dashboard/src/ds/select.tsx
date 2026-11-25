import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  searchIndex,
  spotOf,
  stepOption,
  swallowNextCancel,
  type SelectOption,
  type Spot,
} from './select-logic';

export type { SelectOption } from './select-logic';

/*
 * LISTE DÉROULANTE. Un bouton (rôle combobox) ouvre une liste de choix
 * rendue au plus près du haut de la pile : dans le dialogue ouvert, sinon
 * dans le corps, en position fixe, pour qu'aucun conteneur défilant ne la
 * rogne. Le focus reste sur le bouton ; les flèches déplacent le choix
 * actif, Entrée le retient, Échap referme, et les caractères tapés sautent
 * à la première option qui commence par eux.
 */

export interface SelectProps<Value extends string> {
  value: Value | null;
  options: ReadonlyArray<SelectOption<Value>>;
  onChange: (value: Value) => void;
  placeholder?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
  size?: 'md' | 'sm';
  ref?: Ref<HTMLButtonElement>;
}

export function Select<Value extends string>({
  ref,
  id,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  invalid = false,
  className,
  size = 'md',
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
}: SelectProps<Value>) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const typed = useRef({ buffer: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [spot, setSpot] = useState<Spot | null>(null);
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const selected = options.findIndex((option) => option.value === value);

  const setTrigger = (node: HTMLButtonElement | null) => {
    trigger.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const openList = (activeIndex: number) => {
    const node = trigger.current;
    if (!node) return;
    setSpot(spotOf(node.getBoundingClientRect(), window.innerHeight, node.closest('dialog') ?? document.body));
    setActive(activeIndex >= 0 ? activeIndex : stepOption(options, -1, 1));
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    setOpen(false);
    if (option && !option.disabled && option.value !== value) onChange(option.value);
  };

  const typeAhead = (char: string) => {
    const now = Date.now();
    if (now - typed.current.at > 600) typed.current.buffer = '';
    typed.current.buffer += char.toLowerCase();
    typed.current.at = now;
    const found = searchIndex(options, typed.current.buffer, open ? active : selected);
    if (found < 0) return;
    if (open) setActive(found);
    else openList(found);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const arrow = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (arrow !== 0) {
      event.preventDefault();
      if (open) setActive((current) => stepOption(options, current, arrow));
      else openList(selected);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      setActive(stepOption(options, event.key === 'Home' ? -1 : options.length, event.key === 'Home' ? 1 : -1));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(active);
      else openList(selected);
      return;
    }
    if (event.key === 'Escape') {
      if (!open) return;
      event.preventDefault();
      swallowNextCancel(event.currentTarget);
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      if (open) setOpen(false);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
      typeAhead(event.key);
    }
  };

  // La liste se referme dès que le pointeur la quitte, ou que la page bouge sous elle.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (trigger.current?.contains(target) || list.current?.contains(target))) return;
      setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (list.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Le choix actif reste dans la partie visible de la liste.
  useEffect(() => {
    if (!open) return;
    const node = list.current?.children.item(active);
    if (node instanceof HTMLElement && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [open, active]);

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <>
      <button
        ref={setTrigger}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        disabled={disabled}
        onClick={(event) => {
          // Un clic né du clavier a déjà été traité par keydown.
          if (event.detail === 0) return;
          if (open) setOpen(false);
          else openList(selected);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'flex items-center justify-between gap-2 border-2 px-3 text-left text-sm',
          // Petit format : même zone d'appui (44 px de haut) sous un dessin de 34.
          size === 'sm' ? 'relative h-[34px] before:absolute before:-inset-y-[5px] before:inset-x-0 before:content-[""]' : 'h-11',
          invalid ? 'border-danger' : 'border-line hover:border-edge focus-visible:border-accent aria-expanded:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <span className={cn('truncate', selected < 0 && 'text-ink-faint')}>
          {selected >= 0 ? options[selected]?.label : (placeholder ?? '')}
        </span>
        <span aria-hidden className="-mt-1 block h-2 w-2 shrink-0 border-r-2 border-b-2 border-current" />
      </button>
      {open && spot
        ? createPortal(
            <ul
              ref={list}
              id={listId}
              role="listbox"
              aria-labelledby={id}
              className="notched notch-edge anim-fade fixed z-40 m-0 max-h-64 list-none overflow-y-auto bg-panel p-0"
              style={{ left: spot.left, top: spot.top, bottom: spot.bottom, minWidth: spot.width }}
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  data-active={index === active || undefined}
                  onMouseEnter={() => {
                    if (!option.disabled) setActive(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                  className={cn(
                    'flex min-h-9 cursor-pointer items-center gap-2 border-l-2 px-3 py-1.5 text-sm',
                    index === active ? 'border-l-accent bg-hover text-ink' : 'border-l-transparent text-ink-soft',
                    option.disabled && 'cursor-not-allowed text-ink-faint opacity-60',
                  )}
                >
                  {option.label}
                </li>
              ))}
            </ul>,
            spot.into,
          )
        : null}
    </>
  );
}
