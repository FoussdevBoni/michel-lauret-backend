import app from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase, getDatabaseStatus } from './lib/database';
import { mediaService } from './services/mediaService';

async function startServer(): Promise<void> {
  await connectDatabase();
  const cleanup = setInterval(() => {
    if (getDatabaseStatus() === 'connected')
      void mediaService.cleanup().catch(() => undefined);
  }, 60000);
  cleanup.unref();

  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`Serveur disponible sur http://${env.HOST}:${env.PORT}/api/v1`);
  });

  let shuttingDown = false;

  function shutdown(): void {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(cleanup);
    console.log('Arrêt du serveur en cours…');

    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();

    server.close(() => {
      void disconnectDatabase()
        .then(() => {
          clearTimeout(timeout);
          process.exit(0);
        })
        .catch((error: unknown) => {
          console.error('Erreur pendant l’arrêt du serveur :', error);
          process.exit(1);
        });
    });
  }

  server.on('error', (error) => {
    console.error('Impossible de démarrer le serveur :', error.message);
    void disconnectDatabase().finally(() => process.exit(1));
  });

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void startServer().catch((error: unknown) => {
  console.error('Échec du démarrage :', error);
  void disconnectDatabase().finally(() => process.exit(1));
});
