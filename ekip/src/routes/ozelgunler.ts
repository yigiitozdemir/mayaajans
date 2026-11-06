// Özel Günler: gün ekle/düzenle/sil, firmalar, sorumlu, Hazırladım
import { Hono } from 'hono';
import type { Env, Vars } from '../types';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
