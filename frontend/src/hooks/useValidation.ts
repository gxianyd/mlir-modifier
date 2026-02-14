import { useState, useEffect, useRef, useCallback } from 'react';

interface ValidationState {
  valid: boolean;
  diagnostics: string[];
  connected: boolean;
}

/**
 * Hook that connects to the WebSocket validation endpoint and receives
 * real-time validation status updates after each mutation.
 */
export default function useValidation(): ValidationState {
  const [state, setState] = useState<ValidationState>({
    valid: true,
    diagnostics: [],
    connected: false,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//localhost:8000/ws/validation`);

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setState({
          valid: data.valid,
          diagnostics: data.diagnostics ?? [],
          connected: true,
        });
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
      // Reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return state;
}
