import { createContext, useContext, useState, useEffect } from 'react';
import { resolveUser, TAB_PERMISSIONS, ACTION_PERMISSIONS } from '../lib/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // null = loading, false = denied
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Read token from URL first, fall back to sessionStorage
    const urlToken = new URLSearchParams(window.location.search).get('token');
    const token = urlToken || sessionStorage.getItem('shravan_auth_token');

    // Persist new URL token to sessionStorage
    if (urlToken) sessionStorage.setItem('shravan_auth_token', urlToken);

    resolveUser(token).then(resolved => {
      setUser(resolved || false);
      setLoading(false);
    });
  }, []);

  const value = {
    user,
    loading,
    role:        user?.role        || null,
    agentName:   user?.agentNameMatch || null,
    vikasAlert:  user?.vikasAlert  || false,
    canDo:       (action) => ACTION_PERMISSIONS[user?.role]?.[action] || false,
    canSeeTab:   (tab)    => TAB_PERMISSIONS[user?.role]?.includes(tab) || false,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
