import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProvidersPage } from '@/pages/guild/providers';
import { capabilityRoutes, COOLING_PROVIDER, FAKE_SECRET, providerView } from '@/test/fixtures';
import { guildPath, jsonResponse, renderWithProviders, stubRoutes } from '@/test/render';

/*
 * Rendu de la page « Fournisseurs IA et modèles » sur les formes EXACTES de
 * l'API : registre (zone A), catalogue du fournisseur retenu (zone B),
 * matrice de routage (zone C). La clé n'est jamais affichée : l'API ne
 * l'envoie pas, et l'épreuve vérifie qu'une clé qui filtrerait malgré tout
 * dans la réponse ne se retrouverait pas à l'écran. Une requête qui lève
 * (`getByText`, `findByRole`) échoue l'épreuve : sa présence est la preuve.
 */

describe('ProvidersPage', () => {
  it('affiche le registre, le catalogue et la matrice, sans jamais la clé', async () => {
    const user = userEvent.setup();
    const calls = stubRoutes({
      [`GET ${guildPath('/providers')}`]: () =>
        // Une clé qui fuirait dans la réponse brute : la vue du contrat ne la garde pas.
        jsonResponse({ providers: [{ ...providerView(), apiKey: FAKE_SECRET }, COOLING_PROVIDER] }),
      [`GET ${guildPath('/capabilities')}`]: () => jsonResponse({ routes: capabilityRoutes() }),
      [`POST ${guildPath('/providers/prov-deepseek/test')}`]: () =>
        jsonResponse({ ok: true, summary: '2 modèles', modelsFound: 2, status: providerView().status }),
    });
    renderWithProviders(<ProvidersPage />);

    // Zone A : le registre.
    await screen.findByRole('heading', { name: 'Registre des fournisseurs' });
    await screen.findByRole('heading', { name: 'DeepSeek' });
    screen.getByRole('heading', { name: 'kie.ai' });
    screen.getByText('Instance');
    screen.getByText('Serveur');
    screen.getByText(/••••4242/u);
    screen.getByText('Aucune clé');
    expect(screen.getAllByText(/^Opérationnel/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Refroidissement/u).length).toBeGreaterThan(0);
    screen.getByText('api.deepseek.com');
    screen.getByText(/Activé · 2 modèles/u);
    screen.getByRole('button', { name: 'Ajouter un fournisseur' });

    // Zone B : le catalogue du premier fournisseur, retenu par défaut.
    screen.getByRole('heading', { name: 'Catalogue de modèles' });
    // Une fois dans le catalogue, et dans chacune des trois routes de conversation qui le retient.
    expect(screen.getAllByText('deepseek-chat')).toHaveLength(4);
    expect(screen.getAllByText('deepseek-reasoner')).toHaveLength(1);
    screen.getByText('Découvert');
    screen.getByText('Manuel');
    // Les deux modèles sont de conversation ; le second est en plus signalé comme raisonnement.
    expect(screen.getAllByText('Chat')).toHaveLength(2);
    expect(screen.getAllByText('Raisonnement').length).toBeGreaterThanOrEqual(2);
    screen.getByText('Enregistrer un slug de modèle');

    // Zone C : la matrice des neuf capacités, deux cibles de deux listes chacune.
    screen.getByRole('heading', { name: 'Matrice de routage' });
    screen.getByText('Conversation');
    screen.getByText('Génération d’image');
    screen.getByText('Recherche web');
    expect(screen.getAllByText('Non liée')).toHaveLength(6);
    expect(screen.getAllByText('Suit chat.default')).toHaveLength(2);
    expect(screen.getAllByRole('combobox')).toHaveLength(9 * 2 * 2);

    // Jamais la clé, nulle part dans le document.
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    expect(document.body.textContent).not.toContain('test-key-not-real');

    // Un test de connexion : la requête part sans corps, le résultat se lit sur la carte.
    await user.click(screen.getAllByRole('button', { name: 'Tester' })[0] as HTMLElement);
    await screen.findByText('Connexion établie, 2 modèles découverts.');
    await waitFor(() => expect(calls.mock.calls.some((call) => String(call[0]) === guildPath('/providers/prov-deepseek/test'))).toBe(true));
    const testCall = calls.mock.calls.find((call) => String(call[0]).endsWith('/test'))?.[1];
    expect(testCall?.method).toBe('POST');
    expect(testCall?.body).toBeUndefined();
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
  });
});
