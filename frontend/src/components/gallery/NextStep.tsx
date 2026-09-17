import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { OnboardingProgress } from '../../hooks/useGallery';
import { T } from './styleTokens';

/**
 * The way forward, at the end of the page you are on.
 *
 * The setup strip at the top has always shown the five steps, but nothing on
 * any screen said what to do next: a merchant who chose a look had to go back
 * up to the strip, or guess from the left-hand menu. Reported as "no vas
 * pasando de pasos tipo next, solo vas navegando por los menús" — and that is
 * exactly what the product asked of them.
 *
 * So every screen in the journey ends with one primary action pointing at the
 * next thing that is not done yet, named by what it achieves rather than by
 * the page it opens. It is computed from the same progress the strip uses, so
 * the two can never disagree.
 */

type StepId = 'collections' | 'design' | 'preview' | 'plan' | 'publish';

interface Step {
  id: StepId;
  path: string;
  /** What the merchant is going there to do. */
  cta: string;
  /** Why it is next, in one line. */
  why: string;
  done: (p: OnboardingProgress) => boolean;
}

const JOURNEY: Step[] = [
  {
    id: 'collections',
    path: '/collections',
    cta: 'Sync your catalogue',
    why: 'Sillages needs your products before it can show them.',
    done: (p) => p.catalogueReady,
  },
  {
    id: 'design',
    path: '/design',
    cta: 'Choose how it looks',
    why: 'Pick an arrangement and a treatment. You can change it whenever you like.',
    done: (p) => p.collectionChosen,
  },
  {
    id: 'preview',
    path: '/preview',
    cta: 'See your gallery',
    why: 'Your own products, exactly as a shopper will see them.',
    done: (p) => p.stylePreviewed,
  },
  {
    id: 'plan',
    path: '/plan',
    cta: 'Choose a plan',
    why: 'Publishing is the paid part. The trial is 14 days.',
    done: (p) => p.planChosen,
  },
  {
    id: 'publish',
    path: '/publish',
    cta: 'Put it on your store',
    why: 'One button. Turning it off later leaves your store exactly as it was.',
    done: (p) => p.published,
  },
];

/**
 * Where a merchant goes once the gallery is already live.
 *
 * Setup finishes, and then every screen ended with nothing again: the step
 * strip hides itself when the journey is complete, so a shop with a running
 * gallery was back to reading the left-hand menu. This keeps one forward move
 * on every screen for the whole life of the gallery, not just its first hour.
 */
const KEEP_GOING: Record<string, { path: string; cta: string; why: string }> = {
  '/collections': { path: '/design', cta: 'Choose how it looks', why: 'Your catalogue is in. Change the arrangement or the treatment whenever you like.' },
  '/design': { path: '/preview', cta: 'See your gallery', why: 'Check the change against your own products before it goes out.' },
  '/preview': { path: '/publish', cta: 'Publish your changes', why: 'What you just looked at is not on your store until you publish it.' },
  '/publish': { path: '/performance', cta: 'See what shoppers did', why: 'Views, saves, shares and votes, from the gallery itself.' },
  '/performance': { path: '/design', cta: 'Change how it looks', why: 'A different arrangement or treatment is one click and a republish away.' },
  '/plan': { path: '/publish', cta: 'Go to your gallery', why: 'Your plan is sorted. Publishing and turning it off both live here.' },
};

export function NextStep({ progress }: { progress: OnboardingProgress }) {
  const { pathname } = useLocation();
  const pending = JOURNEY.find((s) => !s.done(progress)) ?? null;

  // Setup is finished: keep one forward move on every screen for the rest of
  // the gallery's life.
  if (!pending) {
    const onward = KEEP_GOING[pathname];
    if (!onward) return null;
    return <Forward eyebrow="Your gallery is live" why={onward.why} to={onward.path} cta={onward.cta} />;
  }

  // Standing on the step that is still outstanding: the page's own buttons are
  // the action. Saying "your gallery is live" here would be a lie, and linking
  // to this page would be noise.
  if (pending.path === pathname) return null;

  const step = pending;

  const position = JOURNEY.findIndex((s) => s.id === step.id) + 1;

  return (
    <Forward
      eyebrow={`Next · step ${position} of ${JOURNEY.length}`}
      why={step.why}
      to={step.path}
      cta={step.cta}
    />
  );
}

/** One primary move, at the end of the page. */
function Forward({ eyebrow, why, to, cta }: { eyebrow: string; why: string; to: string; cta: string }) {
  return (
    <nav
      aria-label="Next step"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 32,
        padding: '18px 20px',
        borderRadius: 14,
        border: `1px solid ${T.line}`,
        background: 'rgba(201,150,74,0.08)',
      }}
    >
      <div style={{ minWidth: 220, flex: 1 }}>
        <p
          style={{
            fontFamily: T.font,
            fontSize: 10,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: T.muted,
            margin: '0 0 4px',
          }}
        >
          {eyebrow}
        </p>
        <p style={{ fontSize: 14, color: T.body, margin: 0, lineHeight: 1.5 }}>{why}</p>
      </div>

      <Link
        to={to}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 20px',
          minHeight: 48,
          borderRadius: 10,
          background: T.gold,
          color: T.ink,
          fontFamily: T.font,
          fontWeight: 700,
          fontSize: 15,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {cta}
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </nav>
  );
}
