// The browser side of the WebSocket connection, plus the notifications state
// that the header and the notifications page share.
import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, tokenStore } from './api.js';
import { useAuth } from './auth.jsx';

// Some hosts (Vercel's serverless functions) cannot keep a WebSocket open.
// Building with VITE_REALTIME=off turns the socket off; notifications are then
// fetched every 30 seconds instead of pushed, and comments appear on reload.
export const REALTIME = import.meta.env.VITE_REALTIME !== 'off';
const POLL_MS = 30_000;

// One socket for the whole app. `auth` is a function, so the current token is
// read again on every (re)connect. It only connects when REALTIME is on;
// otherwise it stays idle and every emit/on is a harmless no-op.
export const socket = io({ autoConnect: false, auth: (cb) => cb({ token: tokenStore.get() }) });

const NotificationsContext = createContext({ items: [], unread: 0, markAllRead: () => {} });
export const useNotifications = () => useContext(NotificationsContext);

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ items: [], unread: 0 });

  // Reconnect whenever the signed-in user changes, so the server puts this
  // socket in the right user room (or in none, after signing out).
  useEffect(() => {
    if (!REALTIME) return;
    socket.disconnect();
    socket.connect();
  }, [user?.username]);

  useEffect(() => {
    if (!user) return setState({ items: [], unread: 0 });

    // 1. Load what happened while we were away (HTTP).
    const load = () =>
      api('/notifications')
        .then((data) => setState({ items: data.notifications, unread: data.unread }))
        .catch(() => {});
    load();

    // 2a. Without WebSockets: ask again every 30 seconds.
    if (!REALTIME) {
      const timer = setInterval(load, POLL_MS);
      return () => clearInterval(timer);
    }

    // 2b. With WebSockets: receive each new one the moment it happens.
    const onNotification = (n) => setState((s) => ({ items: [n, ...s.items], unread: s.unread + 1 }));
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [user?.username]);

  async function markAllRead() {
    setState((s) => ({ items: s.items.map((n) => ({ ...n, read: true })), unread: 0 }));
    await api('/notifications/read', { method: 'POST' }).catch(() => {});
  }

  return <NotificationsContext.Provider value={{ ...state, markAllRead }}>{children}</NotificationsContext.Provider>;
}
