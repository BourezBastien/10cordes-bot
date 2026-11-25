import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IntegrationsPage } from '@/pages/guild/integrations';
import { FAKE_SECRET, integrationView, webhookView } from '@/test/fixtures';
import { guildPath, jsonResponse, renderWithProviders, stubRoutes } from '@/test/render';

/*
 * Rendu de la page « Intégrations » sur les formes EXACTES de l'API : les
 * services spécialisés (zone A), les connecteurs HTTP sortants (zone B). Les
 * en-têtes secrets ne montrent que leur nombre, la clé que son indice. Une
 * requête qui lève (`getByText`) échoue l'épreuve : sa présence est la preuve.
 */

describe('IntegrationsPage', () => {
  it('affiche les services et les connecteurs, sans jamais un secret', async () => {
    const user = userEvent.setup();
    const calls = stubRoutes({
      [`GET ${guildPath('/integrations')}`]: () => jsonResponse({ integrations: [{ ...integrationView, apiKey: FAKE_SECRET }] }),
      [`GET ${guildPath('/webhooks')}`]: () => jsonResponse({ webhooks: [{ ...webhookView, secretHeaders: { Authorization: FAKE_SECRET } }] }),
      [`POST ${guildPath('/integrations/pixellab/test')}`]: () => jsonResponse({ ok: true, summary: 'PixelLab répond', status: 200, ms: 42 }),
    });
    renderWithProviders(<IntegrationsPage />);

    // Zone A : les services spécialisés.
    await screen.findByRole('heading', { name: 'Services spécialisés' });
    await screen.findByRole('heading', { name: 'PixelLab' });
    screen.getByText('pixellab');
    screen.getByText('3 outils débloqués');
    screen.getByText('image.icon');
    screen.getByText('image.emoji');
    screen.getByText('Base instance');
    screen.getByText(/••••7890/u);
    screen.getByRole('button', { name: 'Configurer la clé' });
    expect(screen.getByRole('switch', { name: 'Activer PixelLab sur ce serveur' }).getAttribute('aria-checked')).toBe('true');

    // Zone B : les connecteurs HTTP sortants.
    screen.getByRole('heading', { name: 'Connecteurs HTTP sortants' });
    screen.getByText('Alerte n8n');
    screen.getByText('n8n-alert');
    screen.getByText('POST');
    screen.getByText('hooks.exemple.com');
    screen.getByText('Bearer');
    screen.getByText('1 en-tête secret');
    screen.getByText('200');
    screen.getByRole('button', { name: 'Envoyer un ping test' });
    screen.getByRole('button', { name: 'Ajouter un connecteur' });

    // Jamais un secret, nulle part dans le document.
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    expect(document.body.textContent).not.toContain('test-key-not-real');

    // Un test d'accès : la requête part sans corps, le résultat se lit sur la carte.
    await user.click(screen.getByRole('button', { name: 'Tester l’accès' }));
    await screen.findByText('Accès établi en 42 ms.');
    await waitFor(() => expect(calls.mock.calls.some((call) => String(call[0]) === guildPath('/integrations/pixellab/test'))).toBe(true));
    const testCall = calls.mock.calls.find((call) => String(call[0]).endsWith('/test'))?.[1];
    expect(testCall?.method).toBe('POST');
    expect(testCall?.body).toBeUndefined();
  });
});
