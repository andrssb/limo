import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { TrialExpiredPage } from "./pages/TrialExpiredPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MembersPage } from "./pages/MembersPage";
import { ContactsPage } from "./pages/ContactsPage";
import { InvitesPage } from "./pages/InvitesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ContactDetailPage } from "./pages/ContactDetailPage";
import { CallsPage } from "./pages/CallsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { OAuthCallbackPage } from "./pages/OAuthCallbackPage";
import { ListsPage } from "./pages/ListsPage";
import { ListDetailPage } from "./pages/ListDetailPage";
import { DiscoveryPage } from "./pages/DiscoveryPage";
import { GarimpoPage } from "./pages/GarimpoPage";
import { GoalsPage } from "./pages/GoalsPage";
import { ProductEducationPage } from "./pages/ProductEducationPage";
import { CoachingLivePage } from "./pages/CoachingLivePage";
import { SalesPlaybookPage } from "./pages/SalesPlaybookPage";
import { RankingPage } from "./pages/RankingPage";
import { HeadPanelPage } from "./pages/HeadPanelPage";
import { QualificationInsightsPage } from "./pages/QualificationInsightsPage";
import { PlanPage } from "./pages/PlanPage";
import { AdminPassiveEnginePage } from "./pages/AdminPassiveEnginePage";
import { LiaPage } from "./pages/LiaPage";
import { VoiceSdrPage } from "./pages/VoiceSdrPage";
import { Layout } from "./components/Layout";
import { getStoredUser } from "./lib/api";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const user = getStoredUser();
  if (!user) return <Navigate to="/login" replace />;

  // Check trial expiry synchronously from stored user data.
  // Layout's useEffect refreshes this from the API on every mount.
  // Paid plans (start/metrics/business) are never blocked even if trialEndsAt is in the past.
  const onExpiredPage = location.pathname === "/trial-expired";
  const isPaidPlan    = user.teamPlan && user.teamPlan !== "trial";
  const trialExpired  = !isPaidPlan && user.trialEndsAt && new Date(user.trialEndsAt) < new Date();
  if (!onExpiredPage && trialExpired) {
    return <Navigate to="/trial-expired" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/trial-expired" element={<RequireAuth><TrialExpiredPage /></RequireAuth>} />
      <Route path="/oauth/:provider" element={<OAuthCallbackPage />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="contacts/:id" element={<ContactDetailPage />} />
        <Route path="calls" element={<CallsPage />} />
        <Route path="lists" element={<ListsPage />} />
        <Route path="lists/:id" element={<ListDetailPage />} />
        <Route path="discovery" element={<DiscoveryPage />} />
        <Route path="garimpo" element={<GarimpoPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="product-education" element={<ProductEducationPage />} />
        <Route path="coaching-live" element={<CoachingLivePage />} />
        <Route path="sales-playbook" element={<SalesPlaybookPage />} />
        <Route path="plano" element={<PlanPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="invites" element={<InvitesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="ranking" element={<RankingPage />} />
        <Route path="head-panel" element={<HeadPanelPage />} />
        <Route path="lia" element={<LiaPage />} />
        <Route path="voice-sdr" element={<VoiceSdrPage />} />
        <Route path="qualification" element={<QualificationInsightsPage />} />
        <Route path="admin/passive-engine" element={<AdminPassiveEnginePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
