// Sohbet: kanallar, birebir mesajlar, dosyalar (R2)
import { Hono } from 'hono';
import type { Env, Vars } from '../types';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
