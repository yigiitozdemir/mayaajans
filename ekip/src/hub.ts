// Canlı güncelleme merkezi: herkesin açık ekranı buraya WebSocket ile bağlanır.
// Bir değişiklik olduğunda Worker buraya haber verir, merkez de ilgili kişilere iletir.
// Hibernation API: bağlantı boşta beklerken ücret işlemez.
import { DurableObject } from 'cloudflare:workers';

export type HubMessage =
  | { type: 'tasks' }                                   // iş listesi değişti → yeniden çek
  | { type: 'team' }                                    // ekip / profil değişti
  | { type: 'notify'; notification: unknown }           // kişiye özel bildirim
  | { type: 'remind'; notification: unknown }           // okunmamış atama hatırlatması
  | { type: 'session-revoked' }                         // oturum kapatıldı
  | { type: string; [k: string]: unknown };             // bölüm değişti: clients, days, shoots, chat, nudge…

export class Hub extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') === 'websocket') {
      const uid = req.headers.get('X-User-Id') || '';
      const sid = req.headers.get('X-Session-Id') || '';
      const pair = new WebSocketPair();
      // etiketler: kişiye ve oturuma özel gönderim için
      this.ctx.acceptWebSocket(pair[1], ['u:' + uid, 's:' + sid]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/broadcast' && req.method === 'POST') {
      const { to, session, msg } = (await req.json()) as { to?: string; session?: string; msg: HubMessage };
      const tag = session ? 's:' + session : to ? 'u:' + to : undefined;
      const sockets = tag ? this.ctx.getWebSockets(tag) : this.ctx.getWebSockets();
      const data = JSON.stringify(msg);
      for (const ws of sockets) { try { ws.send(data); } catch { /* kapanmış bağlantı */ } }
      if (msg.type === 'session-revoked') for (const ws of sockets) { try { ws.close(4001, 'oturum kapatıldı'); } catch { /* */ } }
      return new Response(JSON.stringify({ sent: sockets.length }));
    }
    if (url.pathname === '/online') {
      const ids = new Set<string>();
      for (const ws of this.ctx.getWebSockets()) for (const t of this.ctx.getTags(ws)) if (t.startsWith('u:')) ids.add(t.slice(2));
      return new Response(JSON.stringify([...ids]));
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') ws.send('pong');
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, 'kapandı'); } catch { /* */ }
  }
}

export async function broadcast(env: { HUB: DurableObjectNamespace }, msg: HubMessage, target?: { to?: string; session?: string }) {
  const stub = env.HUB.get(env.HUB.idFromName('maya'));
  await stub.fetch('https://hub/broadcast', { method: 'POST', body: JSON.stringify({ ...target, msg }) });
}
