import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth";
import { LoadingScreen } from "../layout/LoadingScreen";
import type React from "react";

export function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { initialized, session } = useAuth();

  if (!initialized) {
    return <LoadingScreen />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
