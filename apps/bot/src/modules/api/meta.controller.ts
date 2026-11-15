import { HttpCtx, HttpController, HttpGet, HttpGuards } from '@spraxium/http';
import type { Context } from 'hono';
import { ModuleManagerService } from '../module-manager/module-manager.service';
import { SessionGuard } from '../../auth/guards/session.guard';

@HttpController('/api/v1/meta')
export class MetaController {
  constructor(private readonly modules: ModuleManagerService) {}

  /** Profil de l'utilisateur connecté (session better-auth). */
  @HttpGet('/session')
  @HttpGuards(SessionGuard)
  async session(@HttpCtx() ctx: Context) {
    const session = ctx.get('session');
    return { user: session.user };
  }

  /** Catalogue des modules — pilote l'UI générique du dashboard. */
  @HttpGet('/modules')
  @HttpGuards(SessionGuard)
  async listModules() {
    return { modules: await this.modules.listModules(null) };
  }
}
