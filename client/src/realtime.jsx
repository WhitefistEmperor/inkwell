// The browser side of the WebSocket connection, plus the notifications state
// that the header bell and the notifications page share.
import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, tokenStore } from './api.js';
import { useAuth } from './auth.jsx';

// One socket for the whole app. `auth` is a function, so the current token is
// read again on every (re)connect.
export const socket = io({ autoConnect: false, auth: (cb) => cb({ token: tokenStore.get() }) });

const NotificationsContext = createContext({ items: [], unread: 0, markAllRead: () => {} });
export const useNotifications = () => useContext(NotificationsContext);

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ items: [], unread: 0 });

  // Reconnect whenever the signed-in user changes, so the server puts this
  // socket in the right user room (or in none, after signing out).
  useEffect(() => {
    socket.disconnect();
    socket.connect();
  }, [user?.username]);

  useEffect(() => {
    if (!user) return setState({ items: [], unread: 0 });

    // 1. Load what happened while we were away (HTTP).
    api('/notifications')
      .then((data) => setState({ items: data.notifications, unread: data.unread }))
      .catch(() => {});

    // 2. Receive what happens from now on (WebSocket push).
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
