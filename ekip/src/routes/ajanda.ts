// Ajandam: kişiye özel notlar (ekran görüntüleriyle), yapılacaklar, takvim ve anımsatıcılar. Yalnızca sahibine açık.
import { Hono } from 'hono';
import type { Env, Vars } from '../types';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

/** Her dakika: zamanı gelen anımsatıcılar için bildirim gönderir. */
export async function ajandaHatirlatma(_env: Env): Promise<void> {}
