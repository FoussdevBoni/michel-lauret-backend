import type { RequestHandler } from 'express';

interface SyncService {
  page: (query: unknown) => Promise<unknown>;
  mutate: (input: unknown, ownerId: string) => Promise<unknown>;
}

export function createSyncController(service: SyncService) {
  const page: RequestHandler = async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await service.page(req.query));
    } catch (error) {
      next(error);
    }
  };
  const mutate: RequestHandler = async (req, res, next) => {
    try {
      res.json(await service.mutate(req.body, res.locals.user.id));
    } catch (error) {
      next(error);
    }
  };
  return { page, mutate };
}
