import type { Request, Response } from 'express';
import * as healthService from '../services/healthService';

export function getHealth(_req: Request, res: Response): void {
  const health = healthService.getHealth();

  res.status(health.status === 'ok' ? 200 : 503).json(health);
}
