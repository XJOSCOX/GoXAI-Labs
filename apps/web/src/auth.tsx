import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { createSupabaseBrowserClient, syncAuthenticatedUser, type ApiUser } from "./api";

interface AuthContextValue {
  dbUser: ApiUser | null;
  error: string | null;
  initialized: boolean;
  loading: boolean;
  session: Session | null;
  supabase: SupabaseClient | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (input: RegisterInput) => Promise<"signed-in" | "check-email">;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [dbUser, setDbUser] = useState<ApiUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  const syncSession = useCallback(async (activeSession: Session | null) => {
    setSession(activeSession);

    if (!activeSession) {
      setDbUser(null);
      return;
    }

    const user = await syncAuthenticatedUser(activeSession);
    setDbUser(user);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      setLoading(true);
      setError(null);

      try {
        const client = await createSupabaseBrowserClient();
        const { data } = await client.auth.getSession();

        if (!mounted) {
          return;
        }

        setSupabase(client);
        await syncSession(data.session);

        const {
          data: { subscription }
        } = client.auth.onAuthStateChange((_event, nextSession) => {
          setSession(nextSession);

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
      error,
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
          const { data, error: signInError } = await supabase.auth.signInWithPassword({
            email,
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
      register: async ({ email, firstName, lastName, password }) => {
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
                name: `${firstName} ${lastName}`.trim()
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
      }
    }),
    [dbUser, error, initialized, loading, session, supabase, syncSession]
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
