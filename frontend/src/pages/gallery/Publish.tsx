import { Link } from 'react-router-dom';
import { useGallery, onboardingProgress } from '../../hooks/useGallery';
import { GalleryPage, Button, Card } from '../../components/gallery/GalleryPage';
import { T } from '../../components/gallery/styleTokens';
import { STYLE_LABELS } from '../../types/gallery';

/**
 * Step 4: go live, turn it off, or go back to a version that worked.
 *
 * Publishing is one click. The one thing Sillages cannot do for the merchant is
 * place the block in their theme, so that instruction is stated plainly here
 * rather than left for support to explain.
 */
export default function Publish() {
  const g = useGallery();
  const progress = onboardingProgress(g.catalog, g.config, g.preview, g.entitlements);
  const config = g.config;
  const status = config?.status ?? 'draft';
  const nothingToShow = (g.preview?.posts.length ?? 0) === 0;
  // Published is not the same as visible: the block still has to be in the
  // theme. Until we have seen the storefront load it, say so.
  const publishedButUnseen = status === 'published' && g.storefront !== null && !g.storefront.seen;
  // Publishing is the paid feature. Offering the button to a shop that cannot
  // use it would only produce a failure they cannot act on.
  const planBlocked = g.entitlements !== null && !g.entitlements.canPublish;

  return (
    <GalleryPage
      title="Publish"
      intro="Turn your gallery on, turn it off, or go back to a previous version. Turning it off leaves your store exactly as it was."
      progress={progress}
      error={g.error}
      onDismissError={g.clearError}
      loading={g.loading}
    >
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusBadge status={status} unseen={publishedButUnseen} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: T.font, fontWeight: 600, fontSize: 15, color: T.ink }}>
              {status === 'published'
                ? publishedButUnseen
                  ? `Published — version ${config?.version}, not seen on your storefront yet`
                  : `Live on your store — version ${config?.version}`
                : status === 'disabled'
                  ? 'Turned off'
                  : 'Not published yet'}
            </div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>
              {config
                ? `${STYLE_LABELS[config.style].name} · ${g.preview?.posts.length ?? 0} products`
                : 'Choose a collection and a look first.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {status !== 'published' && (
              <Button onClick={() => void g.publish()} disabled={g.busy || nothingToShow || planBlocked}>
                {g.busy ? 'Working…' : 'Publish'}
              </Button>
            )}
            {status === 'published' && (
              <>
                <Button variant="secondary" onClick={() => void g.publish()} disabled={g.busy}>
                  Republish changes
                </Button>
                <Button variant="danger" onClick={() => void g.disable()} disabled={g.busy}>
                  Turn off
                </Button>
              </>
            )}
          </div>
        </div>

        {/*
          * Storefronts cache the published gallery for a minute so a shopper
          * never waits on us. That means a merchant who publishes or turns the
          * gallery off and looks at their shop straight away still sees what
          * was there before, and reasonably concludes the button did nothing.
          * Saying so costs one line and saves that conclusion.
          */}
        <p style={{ margin: '12px 0 0', fontSize: 13, color: T.muted }}>
          Your storefront picks changes up within a minute. A page you already have open needs a refresh.
        </p>

        {nothingToShow && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: T.danger }}>
            There is nothing to publish yet. Sync your catalogue, or pick a collection that has products.
          </p>
        )}

        {planBlocked && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#8A6520', lineHeight: 1.6 }}>
            {g.entitlements?.reason}{' '}
            <Link to="/plan" style={{ color: '#8A6520', fontWeight: 600 }}>
              See plans
            </Link>
            {status === 'published' && ' Your gallery is not being served on your storefront while there is no plan.'}
          </p>
        )}

        {publishedButUnseen && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#8A6520', lineHeight: 1.6 }}>
            Your gallery is published, but we have not seen it load on your storefront yet. That almost always means
            the block has not been added to your theme — the one-time step below. If you have just added it, open
            your storefront once and this will update.
          </p>
        )}
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: T.font, fontSize: 15, fontWeight: 600, color: T.ink, margin: '0 0 8px' }}>
          Put it in your theme
        </h2>
        {/*
          * Reassurance first, mechanics second. A merchant clicking a button
          * that opens their own theme needs to know, before they click, that
          * nothing happens until they say so. "It cannot break my shop" is the
          * question being asked, whether or not it is the question typed.
          */}
        <p style={{ margin: '0 0 6px', fontSize: 14, color: T.body, lineHeight: 1.6 }}>
          <strong>Nothing changes until you press Save</strong>, and nothing is written into your theme&rsquo;s code.
          You are previewing, and you can close the tab at any point. Removing the block later removes the gallery
          completely and leaves your store exactly as it was.
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 14, color: T.body, lineHeight: 1.6 }}>
          {g.placements[0]?.autoPlaced
            ? 'Your theme opens with the gallery already placed. Look at it, then press Save.'
            : 'Your theme opens on the right page. Press Add block → Sillages social gallery, then Save.'}
        </p>

        {/*
          * This used to be a five-step instruction, and the step that mattered
          * most — the collection template — was the one a merchant was least
          * likely to find. A shop paying for this should not have to hunt.
          */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {g.placements.map((placement) => (
            <a
              key={placement.id}
              href={placement.url}
              target="_blank"
              rel="noopener"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderRadius: 12,
                border: `1px solid ${placement.id === 'collection' ? 'rgba(201,150,74,0.55)' : T.line}`,
                background: placement.id === 'collection' ? 'rgba(201,150,74,0.08)' : T.surface,
                textDecoration: 'none',
                color: T.ink,
              }}
            >
              <span style={{ flex: 1, minWidth: 200 }}>
                <span style={{ display: 'block', fontFamily: T.font, fontWeight: 600, fontSize: 14 }}>
                  {placement.label}
                </span>
                <span style={{ display: 'block', fontSize: 13, color: T.muted, marginTop: 2, lineHeight: 1.5 }}>
                  {placement.outcome}
                </span>
              </span>
              <span
                style={{
                  fontFamily: T.font,
                  fontWeight: 700,
                  fontSize: 13,
                  padding: '9px 14px',
                  borderRadius: 999,
                  background: T.gold,
                  color: T.ink,
                  whiteSpace: 'nowrap',
                }}
              >
                {placement.autoPlaced ? 'Open my theme →' : 'Open this page in my theme →'}
              </span>
            </a>
          ))}
        </div>

        <div style={{ margin: '14px 0 0', fontSize: 13, color: T.muted, lineHeight: 1.7 }}>
          <p style={{ margin: 0 }}>
            The gallery arrives as its own section at the end of the page. Drag it wherever you like — on your home
            page, above your featured products is where people will actually see it.
          </p>
          <p style={{ margin: '6px 0 0' }}>
            Optional, and reversible in one click: hide your theme&rsquo;s own product grid on the collection page with
            the eye icon, and the gallery becomes the page.
          </p>
          {/*
            * The merchant already met the red banner once. Naming it in advance
            * turns a scare into an expected step.
            */}
          <p style={{ margin: '6px 0 0' }}>
            If your theme shows a message instead of placing it, press <strong>Add block</strong> →{' '}
            <strong>Sillages social gallery</strong>. Same result, one more click.
          </p>
        </div>
      </Card>

      <h2 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 10 }}>
        Previous versions
      </h2>

      {g.versions.length === 0 ? (
        <p style={{ color: T.body, fontSize: 14 }}>Nothing published yet, so there is nothing to go back to.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {g.versions.map((version) => (
            <Card
              key={version.version}
              style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <span style={{ fontFamily: T.font, fontWeight: 600, fontSize: 14, color: T.ink, minWidth: 90 }}>
                Version {version.version}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: T.muted, minWidth: 160 }}>
                {STYLE_LABELS[version.snapshot.style]?.name ?? version.snapshot.style}
                {version.snapshot.heading ? ` · “${version.snapshot.heading}”` : ''}
                {' · '}
                {new Date(version.publishedAt).toLocaleString()}
              </span>
              {version.version !== config?.version && (
                <Button variant="secondary" onClick={() => void g.revert(version.version)} disabled={g.busy}>
                  Restore
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </GalleryPage>
  );
}

function StatusBadge({ status, unseen }: { status: 'draft' | 'published' | 'disabled'; unseen?: boolean }) {
  const palette =
    status === 'published'
      ? unseen
        ? { bg: 'rgba(201,150,74,0.20)', fg: '#8A6520', label: 'Published' }
        : { bg: 'rgba(46,122,74,0.14)', fg: '#2E7A4A', label: 'Live' }
      : status === 'disabled'
        ? { bg: 'rgba(138,46,46,0.12)', fg: T.danger, label: 'Off' }
        : { bg: 'rgba(42,31,20,0.08)', fg: T.muted, label: 'Draft' };

  return (
    <span
      style={{
        padding: '6px 14px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        fontFamily: T.font,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      {palette.label}
    </span>
  );
}
