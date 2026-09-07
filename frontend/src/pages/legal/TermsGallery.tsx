import { LegalFrame, Section } from './LegalFrame';

export default function TermsGallery() {
  return (
    <LegalFrame title="Terms of service" updated="6 September 2026">
      <Section title="What Sillages does">
        <p>
          Sillages reads your Shopify catalogue and publishes it as a shoppable gallery on your storefront, keeping it
          in sync automatically. You choose what it shows, how it looks, and when it goes live.
        </p>
      </Section>

      <Section title="Your store stays yours">
        <p>
          Sillages never edits your theme code. The gallery is added as a Shopify theme app block, which you place and
          remove yourself from the theme editor. Turning the gallery off, or removing the block, leaves your storefront
          exactly as it was.
        </p>
        <p>
          We do not modify your products, your prices, your inventory or your orders. We only read them.
        </p>
      </Section>

      <Section title="Plans, trials and billing">
        <p>
          Basic is $29 per month and Growth is $79 per month, each with a 14-day free trial. Pro is announced but not
          yet on sale.
        </p>
        <p>
          Billing runs through Shopify. You approve every charge in your Shopify admin before it starts, it appears on
          your Shopify invoice, and you can cancel from your Shopify admin at any time. Cancelling turns the gallery
          off at the end of the period; your store is unaffected.
        </p>
        <p>
          While Sillages is in review, billing runs in Shopify's test mode: choosing a plan creates a test charge and
          you are not billed.
        </p>
      </Section>

      <Section title="What we ask of you">
        <p>
          That you have the right to use the product images and text in your own store, and that you do not use
          Sillages to publish anything unlawful. You remain responsible for what your storefront shows.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          We aim to keep Sillages available and the gallery fast, but we do not guarantee uninterrupted service. If
          our API is unreachable, the gallery simply does not render — your storefront keeps working normally, and
          your checkout is never affected.
        </p>
      </Section>

      <Section title="Ending the agreement">
        <p>
          You can uninstall at any time from your Shopify admin. Uninstalling ends billing, turns the gallery off and
          deletes your data as described in our Privacy page.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If we change these terms in a way that materially affects you, we will tell you before the change applies to
          your account.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          <a href="mailto:support@sillages.app">support@sillages.app</a>
        </p>
      </Section>
    </LegalFrame>
  );
}
