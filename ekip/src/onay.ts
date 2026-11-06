// İçerik onay takibi: uzun süredir müşteriden dönüş bekleyen işler için sorumluya hatırlatma (saatlik cron'dan çağrılır).
import type { Env } from './types';
export async function onayHatirlatma(_env: Env): Promise<void> {}
