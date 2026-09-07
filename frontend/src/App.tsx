import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Spinner } from './components/ui/Spinner';
import { HOME_ROUTE, isSocialGalleryMode } from './config/productMode';

// Shared pages (both product modes)
import Landing from './pages/Landing';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Reconnect from './pages/Reconnect';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';

// Legacy product pages — kept in the codebase so PRODUCT_MODE=legacy still works
import Dashboard from './pages/Dashboard';
import BriefDetail from './pages/BriefDetail';
import Briefs from './pages/Briefs';
import Onboarding from './pages/Onboarding';
import Settings from './pages/Settings';
import Alerts from './pages/Alerts';
import Chat from './pages/Chat';
import Actions from './pages/Actions';
import Plans from './pages/Plans';
import Tower from './pages/Tower';

// New product (social_gallery) — Sprint 0 shell, placeholder screens
import Collections from './pages/gallery/Collections';
import Design from './pages/gallery/Design';
import Preview from './pages/gallery/Preview';
import Publish from './pages/gallery/Publish';
import Performance from './pages/gallery/Performance';
import Plan from './pages/gallery/Plan';

// Public before/after generator (Sprint 5) — no account required
import DemoForm from './pages/preview/DemoForm';
import DemoPreview from './pages/preview/DemoPreview';
import PrivacyGallery from './pages/legal/PrivacyGallery';
import TermsGallery from './pages/legal/TermsGallery';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F1EC] flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F1EC] flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (user) {
    return <Navigate to={HOME_ROUTE} replace />;
  }

  return <>{children}</>;
}

/**
 * Legacy product routes. Rendered only when PRODUCT_MODE is `legacy`, so the
 * old screens are recoverable through configuration alone.
 */
function LegacyRoutes() {
  return (
    <>
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/briefs" element={<RequireAuth><Briefs /></RequireAuth>} />
      <Route path="/briefs/:id" element={<RequireAuth><BriefDetail /></RequireAuth>} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/alerts" element={<RequireAuth><Alerts /></RequireAuth>} />
      <Route path="/actions" element={<RequireAuth><Actions /></RequireAuth>} />
      <Route path="/chat" element={<RequireAuth><Chat /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />

      {/* Admin — redirect old /admin/status to /tower */}
      <Route path="/admin/status" element={<Navigate to="/tower" replace />} />
      <Route path="/tower" element={<RequireAuth><Tower /></RequireAuth>} />

      {/* Plans — accessible without full auth (new install redirect from Shopify) */}
      <Route path="/plans" element={<Plans />} />
    </>
  );
}

/**
 * New product shell (PRODUCT_MODE=social_gallery). Sprint 0 ships navigation
 * and placeholder screens only. Dashboard, Briefs, Alerts, Actions, Chat and
 * Tower are intentionally unreachable here.
 */
function SocialGalleryRoutes() {
  return (
    <>
      <Route path="/collections" element={<RequireAuth><Collections /></RequireAuth>} />
      <Route path="/design" element={<RequireAuth><Design /></RequireAuth>} />
      <Route path="/preview" element={<RequireAuth><Preview /></RequireAuth>} />
      <Route path="/publish" element={<RequireAuth><Publish /></RequireAuth>} />
      <Route path="/performance" element={<RequireAuth><Performance /></RequireAuth>} />
      <Route path="/plan" element={<RequireAuth><Plan /></RequireAuth>} />

      {/* The Shopify install and reconnect flows still redirect to the legacy
          destinations. Without these a merchant finishing an install falls
          through to the catch-all and lands on the public marketing page. */}
      <Route path="/dashboard" element={<Navigate to="/collections" replace />} />
      <Route path="/plans" element={<Navigate to="/plan" replace />} />
      <Route path="/onboarding" element={<Navigate to="/collections" replace />} />
      <Route path="/settings" element={<Navigate to="/collections" replace />} />

      {/* Public: the before/after a shop owner is sent. No account needed. */}
      <Route path="/demo" element={<DemoForm />} />
      <Route path="/demo/:token" element={<DemoPreview />} />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <Login />
            </RedirectIfAuthed>
          }
        />

        {/* Password reset — public, no redirect if authed */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Product-specific screens */}
        {isSocialGalleryMode() ? SocialGalleryRoutes() : LegacyRoutes()}

        {/* Reconnect — requires auth but handled internally */}
        <Route path="/reconnect" element={<Reconnect />} />

        {/* Public landing + legal. The legal pages describe the product the
            merchant is actually using, so they follow the product mode. */}
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={isSocialGalleryMode() ? <PrivacyGallery /> : <Privacy />} />
        <Route path="/terms" element={isSocialGalleryMode() ? <TermsGallery /> : <Terms />} />

        {/* Default */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
