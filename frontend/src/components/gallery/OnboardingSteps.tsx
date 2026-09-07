import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import type { OnboardingProgress } from '../../hooks/useGallery';
import { T } from './styleTokens';

const STEPS = [
  { n: 1, label: 'Catalogue synced', to: '/collections' },
  { n: 2, label: 'Choose a collection and a look', to: '/design' },
  { n: 3, label: 'Preview', to: '/preview' },
  // Publishing is a paid feature, so the plan is part of the journey rather
  // than a wall a merchant discovers at the end of it.
  { n: 4, label: 'Choose a plan', to: '/plan' },
  { n: 5, label: 'Publish', to: '/publish' },
] as const;

/**
 * The whole onboarding, always visible: four steps, current one highlighted.
 * A merchant should never have to wonder what to do next.
 */
export function OnboardingSteps({ progress }: { progress: OnboardingProgress }) {
  const done = (n: number) =>
    (n === 1 && progress.catalogueReady) ||
    (n === 2 && progress.stylePreviewed) ||
    (n === 3 && progress.stylePreviewed) ||
    (n === 4 && progress.planChosen) ||
    (n === 5 && progress.published);

  if (progress.complete) return null;

  return (
    <nav
      aria-label="Setup progress"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: 12,
        border: `1px solid ${T.line}`,
        borderRadius: 12,
        background: T.surface,
        marginBottom: 24,
      }}
    >
      {STEPS.map((step) => {
        const complete = done(step.n);
        const current = progress.currentStep === step.n;
        return (
          <Link
            key={step.n}
            to={step.to}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 999,
              textDecoration: 'none',
              fontFamily: T.font,
              fontSize: 13,
              fontWeight: current ? 600 : 500,
              color: current ? T.ink : complete ? T.body : T.muted,
              background: current ? 'rgba(201,150,74,0.16)' : 'transparent',
            }}
            aria-current={current ? 'step' : undefined}
          >
            <span
              aria-hidden="true"
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                background: complete ? T.gold : 'rgba(42,31,20,0.08)',
                color: complete ? T.ink : T.muted,
              }}
            >
              {complete ? <Check size={12} /> : step.n}
            </span>
            {step.label}
          </Link>
        );
      })}
    </nav>
  );
}
