import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { DatasetWorkspaceRoute } from "./components/auth/DatasetWorkspaceRoute";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { AdminPage } from "./pages/admin/AdminPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { OnboardingPage } from "./pages/auth/OnboardingPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { AccountPage } from "./pages/account/AccountPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { DatasetDetailPage } from "./pages/datasets/DatasetDetailPage";
import { DatasetLabelConfigPage } from "./pages/datasets/DatasetLabelConfigPage";
import { DatasetsPage } from "./pages/datasets/DatasetsPage";
import { LabelTemplatesPage } from "./pages/labeling/LabelTemplatesPage";
import { OrganizationSetupPage } from "./pages/organizations/OrganizationSetupPage";
import { ProjectDetailPage, ProjectsPage } from "./pages/projects/ProjectsPage";
import { TaskDetailPage } from "./pages/tasks/TaskDetailPage";
import { TasksPage } from "./pages/tasks/TasksPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <OnboardingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="organization" element={<OrganizationSetupPage />} />
          <Route path="organization/:organizationId" element={<OrganizationSetupPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route
            path="datasets"
            element={
              <DatasetWorkspaceRoute>
                <DatasetsPage />
              </DatasetWorkspaceRoute>
            }
          />
          <Route
            path="datasets/:datasetId"
            element={
              <DatasetWorkspaceRoute>
                <DatasetDetailPage />
              </DatasetWorkspaceRoute>
            }
          />
          <Route
            path="datasets/:datasetId/label-config"
            element={
              <DatasetWorkspaceRoute>
                <DatasetLabelConfigPage />
              </DatasetWorkspaceRoute>
            }
          />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="label-templates" element={<LabelTemplatesPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
