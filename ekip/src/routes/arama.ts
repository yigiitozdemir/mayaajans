// ⌘K hızlı arama: müşteri, iş, çekim, özel gün, (kendi) Ajandam notları/yapılacakları, (erişebildiği) sohbet mesajları
import { Hono } from 'hono';
import type { Env, Vars } from '../types';
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
