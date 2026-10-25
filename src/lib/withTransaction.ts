import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose, { type ClientSession } from 'mongoose';

const currentSession = new AsyncLocalStorage<ClientSession>();

// Les requêtes Mongoose d'un service appelé dans une transaction héritent de sa
// session, y compris celles des services historiques sans paramètre session.
mongoose.set('transactionAsyncLocalStorage', true);

export async function withTransaction<Result>(
  work: (session: ClientSession) => Promise<Result>,
): Promise<Result> {
  const existing = currentSession.getStore();
  if (existing) return work(existing);
  return mongoose.connection.transaction((session) =>
    currentSession.run(session, () => work(session)),
  );
}
