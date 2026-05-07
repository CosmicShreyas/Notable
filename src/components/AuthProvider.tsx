import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clearStoredAuthToken, getStoredAuthToken, setStoredAuthToken } from "../lib/auth";
import { clearMeetingsCache, getMe, logoutFromApi, type User } from "../lib/api";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  token: string | null;
  signInWithToken: (token: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const me = await getMe();
      setUser(me);
    } catch {
      clearStoredAuthToken();
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const storedToken = getStoredAuthToken();
    if (!storedToken) {
      setLoading(false);
      return;
    }

    setToken(storedToken);
    void loadUser();
  }, [loadUser]);

  const signInWithToken = useCallback(async (nextToken: string) => {
    setStoredAuthToken(nextToken);
    setToken(nextToken);
    setLoading(true);
    await loadUser();
  }, [loadUser]);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    await loadUser();
  }, [loadUser]);

  const logout = useCallback(() => {
    return (async () => {
      try {
        if (token) {
          await logoutFromApi();
        }
      } catch {
        // Local sign-out should still succeed even if the API call fails.
      } finally {
        clearStoredAuthToken();
        clearMeetingsCache();
        setToken(null);
        setUser(null);
        setLoading(false);
      }
    })();
  }, [token]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({ user, loading, token, signInWithToken, refreshUser, logout }),
    [user, loading, token, signInWithToken, refreshUser, logout],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
