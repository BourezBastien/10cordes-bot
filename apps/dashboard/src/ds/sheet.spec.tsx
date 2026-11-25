import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/ds/button';
import { Sheet } from '@/ds/sheet';

/*
 * Le tiroir, sur la boîte de dialogue modale native : elle s'ouvre et se
 * ferme par son état, Échap ferme sauf si le tiroir est retenu, et le bouton
 * de fermeture suit la même règle. Toute fermeture range l'état du
 * propriétaire sans attendre l'événement close du dialogue. Ce que jsdom ne
 * sait pas faire (le piège à focus, le voile, le retour du focus) relève du
 * navigateur : il reste à vérifier à la main.
 */

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ouvrir</Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        closeLabel="Fermer"
        title="Tiroir de test"
        description="Une description."
        footer={<Button onClick={() => setOpen(false)}>Terminer</Button>}
      >
        <p>Contenu du tiroir</p>
      </Sheet>
    </>
  );
}

const isOpen = (node: Element | null): boolean => node?.hasAttribute('open') === true;

const labelledBy = (node: Element): string | null => {
  const id = node.getAttribute('aria-labelledby');
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
};

const escape = (node: HTMLDialogElement): Event => {
  const cancel = new Event('cancel', { cancelable: true });
  node.dispatchEvent(cancel);
  return cancel;
};

describe('Sheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fermé d’abord, il s’ouvre par son état, porte son titre et sa description, et se ferme par son pied', async () => {
    const user = userEvent.setup();
    const { container } = render(<Host />);
    const node = container.querySelector('dialog') as HTMLDialogElement;
    expect(isOpen(node)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(isOpen(node)).toBe(true);
    expect(labelledBy(node)).toBe('Tiroir de test');
    expect(document.getElementById(node.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Une description.');
    expect(node.querySelector('button[aria-label="Fermer"]')).not.toBeNull();
    expect(node.querySelector('[role="alert"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Terminer' }));
    expect(isOpen(node)).toBe(false);
    // L'état du propriétaire a suivi : le tiroir se rouvre.
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(isOpen(node)).toBe(true);
  });

  it('Échap ferme le tiroir et range l’état du propriétaire', async () => {
    const user = userEvent.setup();
    const { container } = render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const node = container.querySelector('dialog') as HTMLDialogElement;
    expect(escape(node).defaultPrevented).toBe(true);
    expect(isOpen(node)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(isOpen(node)).toBe(true);
  });

  it('retenu par une demande en cours, le tiroir refuse Échap et son bouton de fermeture', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { container } = render(
      <>
        <Host />
        <Sheet open locked onOpenChange={onOpenChange} closeLabel="Fermer" title="Retenu">
          <p>En cours</p>
        </Sheet>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const held = Array.from(container.querySelectorAll('dialog')).find((node) => node.textContent?.includes('En cours')) as HTMLDialogElement;
    expect(isOpen(held)).toBe(true);
    expect(held.getAttribute('aria-busy')).toBe('true');
    expect(escape(held).defaultPrevented).toBe(true);
    expect(isOpen(held)).toBe(true);
    expect((held.querySelector('button[aria-label="Fermer"]') as HTMLButtonElement).disabled).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('un clic sur le voile ferme, un glissé depuis le contenu ne ferme pas', () => {
    const { container } = render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const node = container.querySelector('dialog') as HTMLDialogElement;
    // Pointer posé sur le contenu, relâché sur le voile : pas de fermeture.
    fireEvent.pointerDown(node.querySelector('p') as Element);
    fireEvent.click(node);
    expect(isOpen(node)).toBe(true);
    // Pointer posé sur le voile lui-même : fermeture.
    fireEvent.pointerDown(node);
    fireEvent.click(node);
    expect(isOpen(node)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(isOpen(node)).toBe(true);
  });

  it('un moteur qui ne lance pas l’événement close laisse l’état du propriétaire juste', async () => {
    // Certains moteurs n'émettent rien à la fermeture d'un dialogue : la fermeture passe par nous.
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    const user = userEvent.setup();
    const { container } = render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const node = container.querySelector('dialog') as HTMLDialogElement;
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(isOpen(node)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(isOpen(node)).toBe(true);
    expect(escape(node).defaultPrevented).toBe(true);
    expect(isOpen(node)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(isOpen(node)).toBe(true);
  });
});
