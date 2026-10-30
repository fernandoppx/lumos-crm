import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  FirebaseUser,
} from '../lib/firebase.ts';
import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { UserProfile, isProfileActive } from '../types/crm.ts';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  isActive: boolean;
  isAdmin: boolean;
  isManager: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (name: string, email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const BOOTSTRAP_DOC = () => doc(db, 'settings', 'bootstrap');

/**
 * Garante o perfil do usuário.
 * - Se o sistema ainda não tem administrador, o usuário atual se torna o administrador (uma única vez).
 * - Contas novas entram como "Vendedor" aguardando aprovação.
 * - Contas antigas (sem o campo active) continuam funcionando.
 */
async function ensureProfile(currentUser: FirebaseUser, displayName?: string): Promise<void> {
  const userRef = doc(db, 'users', currentUser.uid);
  const name = displayName || currentUser.displayName || currentUser.email?.split('@')[0] || 'Usuário';

  await runTransaction(db, async (tx) => {
    const bootSnap = await tx.get(BOOTSTRAP_DOC());
    const userSnap = await tx.get(userRef);
    const now = new Date().toISOString();

    if (!bootSnap.exists()) {
      tx.set(BOOTSTRAP_DOC(), { adminUid: currentUser.uid, createdAt: now });
      if (userSnap.exists()) {
        tx.update(userRef, { role: 'admin', active: true });
      } else {
        tx.set(userRef, {
          uid: currentUser.uid,
          name,
          email: currentUser.email || '',
          role: 'admin',
          active: true,
          ...(currentUser.photoURL ? { avatarUrl: currentUser.photoURL } : {}),
          createdAt: now,
        });
      }
      return;
    }

    if (!userSnap.exists()) {
      tx.set(userRef, {
        uid: currentUser.uid,
        name,
        email: currentUser.email || '',
        role: 'sales_rep',
        active: false,
        ...(currentUser.photoURL ? { avatarUrl: currentUser.photoURL } : {}),
        createdAt: now,
      });
    }
  });
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        await ensureProfile(currentUser);
      } catch (err) {
        console.error('Erro ao preparar perfil:', err);
      }

      // Perfil em tempo real: aprovação ou mudança de papel aparece sem recarregar a página
      unsubProfile = onSnapshot(
        doc(db, 'users', currentUser.uid),
        (snap) => {
          setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
          setLoading(false);
        },
        async () => {
          try {
            const snap = await getDoc(doc(db, 'users', currentUser.uid));
            setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
          } finally {
            setLoading(false);
          }
        }
      );
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const handleSignInGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const handleSignInEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const handleSignUpEmail = async (name: string, email: string, pass: string) => {
    const res = await createUserWithEmailAndPassword(auth, email, pass);
    await ensureProfile(res.user, name);
  };

  const handleLogout = async () => {
    await signOut(auth);
    setProfile(null);
  };

  const active = isProfileActive(profile);
  const role = profile?.role || 'sales_rep';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isActive: active,
        isAdmin: active && role === 'admin',
        isManager: active && (role === 'admin' || role === 'manager'),
        signInWithGoogle: handleSignInGoogle,
        signInWithEmail: handleSignInEmail,
        signUpWithEmail: handleSignUpEmail,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de AuthProvider');
  }
  return context;
}
