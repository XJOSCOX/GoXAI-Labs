import { useEffect, useRef } from "react";

import { useAuth } from "../../auth";

export type AuthSession = ReturnType<typeof useAuth>["session"];

export function useLatestSessionRef(session: AuthSession) {
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  return sessionRef;
}

export function getSessionKey(session: AuthSession) {
  return session?.user.id ?? "signed-out";
}
