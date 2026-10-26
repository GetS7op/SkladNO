import { CloudOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Плашка «нет связи»: данные могут быть устаревшими, сканы копятся в очереди. */
export function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (online) return null;
  return (
    <div className="offline-banner">
      <CloudOff size={16} /> Нет связи с сервером. Сканы сохраняются на устройстве и отправятся, когда связь
      вернётся.
    </div>
  );
}
