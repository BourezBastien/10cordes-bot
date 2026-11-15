import { defineHttp } from '@spraxium/http';
import { AppModule } from '../src/app.module';

export const httpConfig = defineHttp({
  enabled: true,
  host: '127.0.0.1',
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
