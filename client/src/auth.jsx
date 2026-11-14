// Global "who is signed in" state, shared through React Context so any
// component can call useAuth() instead of receiving the user through props.
import { createContext, useContext, useEffect, useState } from 'react';
import { api, tokenStore } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // True until we know whether the saved token is still valid.
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  // On page load: if a token was saved earlier, ask the server who it belongs to.
  useEffect(() => {
    if (!tokenStore.get()) return;
    api('/user')
      .then((data) => setUser(data.user))
      .catch(() => tokenStore.clear()) // expired or invalid token
      .finally(() => setLoading(false));
  }, []);

  // Register, login and profile updates all answer with { user: { ..., token } }.
  async function send(path, method, fields) {
    const data = await api(path, { method, body: { user: fields } });
    tokenStore.set(data.user.token);
    setUser(data.user);
  }

  const value = {
    user,
    loading,
    login: (credentials) => send('/users/login', 'POST', credentials),
    register: (credentials) => send('/users', 'POST', credentials),
    updateUser: (fields) => send('/user', 'PUT', fields),
    logout: () => {
      tokenStore.clear();
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
