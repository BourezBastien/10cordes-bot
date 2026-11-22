import { defineHttp } from '@spraxium/http';
import { AppModule } from '../src/app.module';

export const httpConfig = defineHttp({
  enabled: true,
  // 127.0.0.1 par défaut (dev local : l'API n'est PAS exposée hors machine).
  // En conteneur, docker-compose pose HTTP_HOST=0.0.0.0 pour que le port
  // publié soit réellement joignable.
  host: process.env.HTTP_HOST ?? '127.0.0.1',
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  apiKey: process.env.HTTP_API_KEY,
  sharding: false,
  module: AppModule,
  security: {
    cors: {
      origins: (process.env.DASHBOARD_ORIGIN ?? 'http://localhost:5173').split(','),
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
      credentials: true,
      maxAge: 600,
    },
  },
});
