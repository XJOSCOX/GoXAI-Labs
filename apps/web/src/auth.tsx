import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  createSupabaseBrowserClient,
  loadBackendConfig,
  resolveLoginEmail,
  syncAuthenticatedUser,
  updateUserProfile,
  type ApiUser,
  type PlatformTaskEconomics,
  type PlatformFeatures
} from "./api";

interface AuthContextValue {
  dbUser: ApiUser | null;
  economics: PlatformTaskEconomics;
  error: string | null;
  features: PlatformFeatures;
  initialized: boolean;
  loading: boolean;
  session: Session | null;
  supabase: SupabaseClient | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (input: RegisterInput) => Promise<"signed-in" | "check-email">;
  refreshUser: () => Promise<void>;
  setFeatures: (features: PlatformFeatures) => void;
  updateProfile: (input: { firstName?: string; lastName?: string; jobTitle?: string }) => Promise<void>;
}

export interface RegisterInput {
  signupType: "user" | "organization";
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationName?: string;
  organizationEmail?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const defaultPlatformFeatures: PlatformFeatures = {
  aiEnabled: false,
  payments: {
    paypalEnabled: true,
    plaidEnabled: false,
    stripeEnabled: false
  }
};
const defaultPlatformEconomics: PlatformTaskEconomics = {
  freeTaskPostingFeeCredits: 0,
  platformFeeRate: 0.3
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [dbUser, setDbUser] = useState<ApiUser | null>(null);
  const [economics, setEconomics] = useState<PlatformTaskEconomics>(defaultPlatformEconomics);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<PlatformFeatures>(defaultPlatformFeatures);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const lastSyncedUserIdRef = useRef<string | null>(null);

  const syncSession = useCallback(async (activeSession: Session | null) => {
    setSession(activeSession);

    if (!activeSession) {
      lastSyncedUserIdRef.current = null;
      setDbUser(null);
      return;
    }

    if (lastSyncedUserIdRef.current === activeSession.user.id) {
      return;
    }

    const user = await syncAuthenticatedUser(activeSession);
    lastSyncedUserIdRef.current = activeSession.user.id;
    setDbUser(user);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      setLoading(true);
      setError(null);

      try {
        const config = await loadBackendConfig();
        const client = await createSupabaseBrowserClient();
        const { data } = await client.auth.getSession();

        if (!mounted) {
          return;
        }

        setEconomics(config.economics ?? defaultPlatformEconomics);
        setFeatures(config.features ?? defaultPlatformFeatures);
        setSupabase(client);
        await syncSession(data.session);

        const {
          data: { subscription }
        } = client.auth.onAuthStateChange((_event, nextSession) => {
          void syncSession(nextSession).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "Unable to sync user session.");
          });
        });

        return () => subscription.unsubscribe();
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "Unable to initialize auth.");
        }
      } finally {
        if (mounted) {
          setInitialized(true);
          setLoading(false);
        }
      }
    }

    const cleanup = boot();

    return () => {
      mounted = false;
      void cleanup.then((dispose) => dispose?.());
    };
  }, [syncSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      dbUser,
      economics,
      error,
      features,
      initialized,
      loading,
      session,
      supabase,
      login: async (email, password) => {
        if (!supabase) {
          throw new Error("Authentication is not ready.");
        }

        setLoading(true);
        setError(null);

        try {
          const resolvedEmail = await resolveLoginEmail(email);
          const { data, error: signInError } = await supabase.auth.signInWithPassword({
            email: resolvedEmail,
            password
          });

          if (signInError) {
            throw signInError;
          }

          await syncSession(data.session);
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "Unable to log in.";
          setError(message);
          throw new Error(message);
        } finally {
          setLoading(false);
        }
      },
      logout: async () => {
        if (!supabase) {
          return;
        }

        await supabase.auth.signOut();
        setSession(null);
        setDbUser(null);
      },
      register: async ({
        email,
        firstName,
        lastName,
        organizationEmail,
        organizationName,
        password,
        signupType
      }) => {
        if (!supabase) {
          throw new Error("Authentication is not ready.");
        }

        setLoading(true);
        setError(null);

        try {
          const { data, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                first_name: firstName,
                last_name: lastName,
                name: `${firstName} ${lastName}`.trim(),
                organization_email: organizationEmail,
                organization_name: organizationName,
                signup_type: signupType,
                workspace_name: "Main workspace"
              }
            }
          });

          if (signUpError) {
            throw signUpError;
          }

          if (data.session) {
            await syncSession(data.session);
            return "signed-in";
          }

          return "check-email";
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "Unable to register.";
          setError(message);
          throw new Error(message);
        } finally {
          setLoading(false);
        }
      },
      refreshUser: async () => {
        if (!session) {
          return;
        }

        const user = await syncAuthenticatedUser(session);
        setDbUser(user);
      },
      setFeatures,
      updateProfile: async (input) => {
        if (!session) {
          throw new Error("Authentication is required.");
        }

        setLoading(true);
        setError(null);

        try {
          const user = await updateUserProfile(session, input);
          setDbUser(user);
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "Unable to update profile.";
          setError(message);
          throw new Error(message);
        } finally {
          setLoading(false);
        }
      }
    }),
    [dbUser, economics, error, features, initialized, loading, session, supabase, syncSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}

export function getFormValue(event: FormEvent<HTMLFormElement>, name: string) {
  const form = new FormData(event.currentTarget);
  const value = form.get(name);

  return typeof value === "string" ? value.trim() : "";
}
