// iPhone / tarayıcı bildirimleri (Web Push): abone ol / çık
import { Hono } from 'hono';
import type { Env, Vars } from '../types';
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
