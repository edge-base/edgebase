/**
 * useAuth — hook for accessing authentication state and user data.
 *
 * Usage:
 * ```tsx
 * const { user, loading, signOut } = useAuth();
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import type { TokenUser } from '@edgebase/web';
import { useAuthContext } from '../context.js';

export interface UseAuthReturn {
  /** Current authenticated user, or null */
  user: TokenUser | null;
  /** Whether the auth state is still loading */
  loading: boolean;
  /** Sign out the current user */
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const { client } = useAuthContext();
  const [user, setUser] = useState<TokenUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial user state
    const currentUser = client.auth.currentUser;
    setUser(currentUser);
    setLoading(false);

    // Subscribe to auth state changes
    const unsubscribe = client.auth.onAuthStateChange((newUser) => {
      setUser(newUser);
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, [client]);

  const signOut = useCallback(async () => {
    await client.auth.signOut();
  }, [client]);

  return { user, loading, signOut };
}
