import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { SecurityService } from './security.service';
import { VerificationJoinListener } from './verification.listener';
import { VerificationService } from './verification.service';
import { VerifyAnswer0Handler, VerifyAnswer1Handler, VerifyAnswer2Handler, VerifyGateHandler } from './verification.handlers';
import { VerifyAnswer0, VerifyAnswer1, VerifyAnswer2, VerifyGateButton } from './verification.components';

// Sécurité : gate de vérification anti-raid à l'arrivée (captcha math via
// boutons, kick planifié DB+timer), tools de configuration par l'agent.
@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  providers: [VerificationService, SecurityService],
  listeners: [VerificationJoinListener],
  handlers: [VerifyGateHandler, VerifyAnswer0Handler, VerifyAnswer1Handler, VerifyAnswer2Handler],
})
export class SecurityModule {}
