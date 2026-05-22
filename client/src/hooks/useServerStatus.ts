import { useCallback, useEffect, useRef, useState } from 'react';

export type ServerErrorCode = number | 'network' | null;

export interface ServerStatus {
  isOnline: boolean;
  lastCheck: Date | null;
  errorCode: ServerErrorCode;
  errorMessage: string | null;
}

export interface UseServerStatusReturn extends ServerStatus {
  checkServer: () => Promise<void>;
}

export function useServerStatus(checkInterval = 30000): UseServerStatusReturn {
  const [serverStatus, setServerStatus] = useState<ServerStatus>({
    isOnline: true,
    lastCheck: null,
    errorCode: null,
    errorMessage: null,
  });
  const controllerRef = useRef<AbortController | null>(null);

  const checkServer = useCallback(async () => {
    if (controllerRef.current) controllerRef.current.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('/api/health', {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        setServerStatus({
          isOnline: true,
          lastCheck: new Date(),
          errorCode: null,
          errorMessage: null,
        });
      } else {
        setServerStatus({
          isOnline: false,
          lastCheck: new Date(),
          errorCode: response.status,
          errorMessage: `Erreur serveur : ${response.status}`,
        });
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') return;

      setServerStatus({
        isOnline: false,
        lastCheck: new Date(),
        errorCode: 'network',
        errorMessage: 'Connexion au serveur impossible',
      });
    }
  }, []);

  useEffect(() => {
    checkServer();
    const interval = setInterval(checkServer, checkInterval);

    const handleOnline = () => checkServer();
    const handleOffline = () => {
      setServerStatus({
        isOnline: false,
        lastCheck: new Date(),
        errorCode: 'network',
        errorMessage: 'Vous êtes hors ligne',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(interval);
      if (controllerRef.current) controllerRef.current.abort();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkServer, checkInterval]);

  return {
    ...serverStatus,
    checkServer,
  };
}
