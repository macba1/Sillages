import { GalleryShell } from '../../components/layout/GalleryShell';

/**
 * Sprint 0 placeholder. Every screen of the new product renders this until its
 * own sprint builds it, so the shell is navigable and nobody mistakes an empty
 * screen for a broken one.
 */
export function GalleryPlaceholder({
  title,
  description,
  sprint,
  children,
}: {
  title: string;
  description: string;
  sprint: string;
  children?: React.ReactNode;
}) {
  return (
    <GalleryShell>
      <div style={{ maxWidth: 720, padding: '48px 40px' }}>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 10,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: '#A89880',
            marginBottom: 10,
          }}
        >
          Sillages · Social gallery
        </p>
        <h1
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 30,
            fontWeight: 700,
            color: '#2A1F14',
            marginBottom: 12,
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: '#5C4B38', marginBottom: 24 }}>
          {description}
        </p>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(201,150,74,0.15)',
            color: '#8A6520',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Not built yet — {sprint}
        </div>
        {children}
      </div>
    </GalleryShell>
  );
}
