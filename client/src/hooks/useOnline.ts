import { useEffect, useState } from 'react';

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    window.addEventListener('pn:online', up);
    window.addEventListener('pn:offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener('pn:online', up);
      window.removeEventListener('pn:offline', down);
    };
  }, []);
  return online;
}

