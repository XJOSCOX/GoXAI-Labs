import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/auth/LoginPage";
import { OnboardingPage } from "./pages/auth/OnboardingPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { AccountPage } from "./pages/account/AccountPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { DatasetDetailPage } from "./pages/datasets/DatasetDetailPage";
import { DatasetsPage } from "./pages/datasets/DatasetsPage";
import { OrganizationSetupPage } from "./pages/organizations/OrganizationSetupPage";
import { ProjectDetailPage, ProjectsPage } from "./pages/projects/ProjectsPage";
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
          <Route path="datasets" element={<DatasetsPage />} />
          <Route path="datasets/:datasetId" element={<DatasetDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="account" element={<AccountPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
