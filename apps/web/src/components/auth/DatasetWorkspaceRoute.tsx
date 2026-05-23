import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth";
import { useOrganizations } from "../../hooks/useResources";
import { LoadingScreen } from "../layout/LoadingScreen";

export function DatasetWorkspaceRoute({ children }: { children: React.ReactElement }) {
  const { dbUser, session } = useAuth();
  const { loading, organizations } = useOrganizations(session);
  const canUseDatasetWorkspace =
    dbUser?.globalRole === "SUPER_ADMIN" ||
    organizations.some((organization) => ["OWNER", "ADMIN", "MANAGER"].includes(organization.role));

  if (loading) {
    return <LoadingScreen />;
  }

  if (!canUseDatasetWorkspace) {
    return <Navigate to="/projects" replace />;
  }

  return children;
}
