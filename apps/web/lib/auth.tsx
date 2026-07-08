'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { LoginResponse } from '@healthflow/shared-types';

type SessionUser = LoginResponse['user'];

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  ready: boolean;
  setSession: (session: LoginResponse) => void;
  logout: () => void;
}

const STORAGE_KEY = 'healthflow.session';
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  // Rehidrata la sesión desde localStorage al montar.
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as LoginResponse;
        setToken(parsed.accessToken);
        setUser(parsed.user);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setReady(true);
  }, []);

  const setSession = (session: LoginResponse) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setToken(session.accessToken);
    setUser(session.user);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, ready, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
