// Yönetici özeti (yalnızca yönetici)
export function YoneticiOzeti({ openTask }: { openTask: (id: string) => void }) {
  void openTask;
  return <div class="page"><h1 class="h1">Yönetici özeti</h1></div>;
}
