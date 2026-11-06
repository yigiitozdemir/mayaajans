// Çekim Planı: çekimler, ekip, hazırlık listesi, "yarın çekim var" hatırlatması
import { Hono } from 'hono';
import type { Env, Vars } from '../types';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

/** Her gün 16:30 (İstanbul): yarın çekimi olan ekibe ve #çekim-planı kanalına hatırlatma. */
export async function cekimHatirlatma(_env: Env): Promise<void> {}
