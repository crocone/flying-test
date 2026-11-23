import type { Spec } from '../core/spec.ts';
import { ornithopter } from './ornithopter.ts';
import { cessna172 } from './cessna172.ts';
import { r22 } from './r22.ts';
import { quadcopter } from './quadcopter.ts';
import { smartbird, snowbird } from './flappers.ts';

export const PRESETS: Record<string, Spec> = {
  ornithopter,
  cessna172,
  r22,
  quadcopter,
  smartbird,
  snowbird,
};
