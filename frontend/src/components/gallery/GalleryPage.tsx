import { GalleryShell } from '../layout/GalleryShell';
import { OnboardingSteps } from './OnboardingSteps';
import { T } from './styleTokens';
import type { OnboardingProgress } from '../../hooks/useGallery';

/**
 * Common frame for every admin screen: shell, title, the onboarding strip and
 * a single place where errors are shown. Errors are never silent.
 */
export function GalleryPage({
  title,
  intro,
  progress,
  error,
  onDismissError,
  loading,
  children,
  actions,
}: {
  title: string;
  intro?: string;
  progress?: OnboardingProgress;
  error?: string | null;
  onDismissError?: () => void;
  loading?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <GalleryShell>
      <div style={{ maxWidth: 900, padding: '40px 24px 64px', margin: '0 auto' }}>
        <p
          style={{
            fontFamily: T.font,
            fontSize: 10,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: T.muted,
            marginBottom: 10,
          }}
        >
          Sillages · Social gallery
        </p>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
          <h1 style={{ fontFamily: T.font, fontSize: 28, fontWeight: 700, color: T.ink, margin: 0, flex: 1 }}>
            {title}
          </h1>
          {actions}
        </div>

        {intro && (
          <p style={{ fontSize: 15, lineHeight: 1.6, color: T.body, marginTop: 0, marginBottom: 24 }}>{intro}</p>
        )}

        {progress && <OnboardingSteps progress={progress} />}

        {error && (
          <div
            role="alert"
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              border: `1px solid ${T.danger}33`,
              background: '#FDF6F5',
              color: T.danger,
              borderRadius: 12,
              padding: '12px 14px',
              marginBottom: 20,
              fontSize: 14,
            }}
          >
            <span style={{ flex: 1 }}>{error}</span>
            {onDismissError && (
              <button
                onClick={onDismissError}
                aria-label="Dismiss"
                style={{ border: 0, background: 'transparent', color: T.danger, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </div>
        )}

        {loading ? <p style={{ color: T.body, fontSize: 14 }}>Loading…</p> : children}
      </div>
    </GalleryShell>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
}) {
  const palette =
    variant === 'primary'
      ? { bg: T.gold, fg: T.ink, border: 'transparent' }
      : variant === 'danger'
        ? { bg: 'transparent', fg: T.danger, border: `${T.danger}55` }
        : { bg: 'transparent', fg: T.ink, border: T.line };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 18px',
        minHeight: 44,
        borderRadius: 10,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.fg,
        fontFamily: T.font,
        fontWeight: 600,
        fontSize: 14,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        border: `1px solid ${T.line}`,
        borderRadius: 12,
        padding: 16,
        background: T.surface,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
