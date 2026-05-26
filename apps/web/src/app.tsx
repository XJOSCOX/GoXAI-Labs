import { lazy, Suspense, type ComponentType } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./auth";
import { DatasetWorkspaceRoute } from "./components/auth/DatasetWorkspaceRoute";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppErrorBoundary } from "./components/layout/AppErrorBoundary";
import { AppShell } from "./components/layout/AppShell";
import { LoadingScreen } from "./components/layout/LoadingScreen";

const AccountPage = lazy(() => import("./pages/account/AccountPage").then((module) => toDefault(module.AccountPage)));
const AdminPage = lazy(() => import("./pages/admin/AdminPage").then((module) => toDefault(module.AdminPage)));
const AuditPage = lazy(() => import("./pages/audit/AuditPage").then((module) => toDefault(module.AuditPage)));
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage").then((module) => toDefault(module.DashboardPage)));
const DatasetDetailPage = lazy(() => import("./pages/datasets/DatasetDetailPage").then((module) => toDefault(module.DatasetDetailPage)));
const DatasetLabelConfigPage = lazy(() => import("./pages/datasets/DatasetLabelConfigPage").then((module) => toDefault(module.DatasetLabelConfigPage)));
const DatasetsPage = lazy(() => import("./pages/datasets/DatasetsPage").then((module) => toDefault(module.DatasetsPage)));
const LabelTemplateFormPage = lazy(() => import("./pages/labeling/LabelTemplateFormPage").then((module) => toDefault(module.LabelTemplateFormPage)));
const LabelTemplateManagerPage = lazy(() => import("./pages/labeling/LabelTemplateManagerPage").then((module) => toDefault(module.LabelTemplateManagerPage)));
const LabelTemplatesPage = lazy(() => import("./pages/labeling/LabelTemplatesPage").then((module) => toDefault(module.LabelTemplatesPage)));
const LoginPage = lazy(() => import("./pages/auth/LoginPage").then((module) => toDefault(module.LoginPage)));
const OnboardingPage = lazy(() => import("./pages/auth/OnboardingPage").then((module) => toDefault(module.OnboardingPage)));
const OrganizationSetupPage = lazy(() => import("./pages/organizations/OrganizationSetupPage").then((module) => toDefault(module.OrganizationSetupPage)));
const ProjectDetailPage = lazy(() => import("./pages/projects/ProjectsPage").then((module) => toDefault(module.ProjectDetailPage)));
const ProjectsPage = lazy(() => import("./pages/projects/ProjectsPage").then((module) => toDefault(module.ProjectsPage)));
const QualityPage = lazy(() => import("./pages/quality/QualityPage").then((module) => toDefault(module.QualityPage)));
const RegisterPage = lazy(() => import("./pages/auth/RegisterPage").then((module) => toDefault(module.RegisterPage)));
const TaskDetailPage = lazy(() => import("./pages/tasks/TaskDetailPage").then((module) => toDefault(module.TaskDetailPage)));
const TasksPage = lazy(() => import("./pages/tasks/TasksPage").then((module) => toDefault(module.TasksPage)));

function toDefault(component: ComponentType) {
  return { default: component };
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

function AppRoutes() {
  const location = useLocation();

  return (
    <AppErrorBoundary resetKey={location.key}>
      <Suspense fallback={<LoadingScreen />}>
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
            <Route path="quality" element={<QualityPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="label-templates" element={<LabelTemplatesPage />} />
            <Route path="label-templates/manage" element={<LabelTemplateManagerPage />} />
            <Route path="label-templates/categories/:categoryKey/templates/new" element={<LabelTemplateFormPage />} />
            <Route path="label-templates/templates/new" element={<LabelTemplateFormPage />} />
            <Route path="label-templates/templates/:templateId/edit" element={<LabelTemplateFormPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
