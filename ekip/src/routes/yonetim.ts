// Yönetici özeti (yalnızca yönetici): ekip iş yükü, gecikenler, haftalık tamamlanan, müşteri başı iş yükü, onay bekleyenler, yedek durumu
import { Hono } from 'hono';
import type { Env, Vars } from '../types';
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
