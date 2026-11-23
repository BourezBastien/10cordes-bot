import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { SecurityService } from './security.service';

// Sécurité : permission nodes RBAC (allow/deny par tool pour rôle/membre).
// Le gate captcha historique a été retiré : l'agent construit une surface
// de vérification à la demande via le moteur générique.
@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  providers: [SecurityService],
})
export class SecurityModule {}
