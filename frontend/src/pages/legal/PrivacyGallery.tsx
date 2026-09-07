import { LegalFrame, Section } from './LegalFrame';

/**
 * Privacy policy for the social-gallery product.
 *
 * Written to match what the code actually does. Every claim here is enforced
 * somewhere in the codebase and covered by a test — if the behaviour changes,
 * this page has to change with it.
 */
export default function PrivacyGallery() {
  return (
    <LegalFrame title="Privacy" updated="6 September 2026">
      <Section title="In short">
        <p>
          Sillages turns your Shopify catalogue into a shoppable gallery. To do that we read your products and we
          count what happens in the gallery. We do not collect anything that identifies your shoppers — no names, no
          email addresses, no phone numbers, no addresses, no customer records and no IP addresses.
        </p>
      </Section>

      <Section title="What we read from your store">
        <p>With your permission, and only the permissions we ask for:</p>
        <ul>
          <li>Products, variants, prices, images and collections (<code>read_products</code>)</li>
          <li>Stock levels, so a sold-out item is shown as sold out (<code>read_inventory</code>)</li>
        </ul>
        <p>
          We do not ask for access to your orders, your customers, your checkouts, your discounts or your theme code,
          and we cannot read them.
        </p>
      </Section>

      <Section title="What we measure in the gallery">
        <p>So you can see whether the gallery is working, we record:</p>
        <ul>
          <li>that a gallery was viewed, and which products were seen, opened and configured</li>
          <li>saves, shares and adds to cart</li>
          <li>that a checkout started and that an order completed, with its total</li>
        </ul>
        <p>
          Each of these carries a random identifier the shopper's own browser generates for itself. It is not linked
          to a person, it is not shared between stores, and it lives only in that browser. Our measurement endpoint
          rejects any request that contains an email address, a name, a phone number, an address, a customer id or a
          user agent — the whole batch is refused rather than quietly cleaned up.
        </p>
      </Section>

      <Section title="Consent">
        <p>
          Our storefront pixel runs inside Shopify's sandbox and sends nothing until Shopify tells it that analytics
          processing is allowed for that visitor. If a shopper changes their choice, it stops. We declare no
          marketing or preferences processing and we do not sell data.
        </p>
      </Section>

      <Section title="Cookies and local storage">
        <p>
          We set no cookies. The gallery stores two things in the shopper's own browser: the random session
          identifier above, and the list of products they saved. Both stay on their device and are readable only by
          that store's gallery.
        </p>
      </Section>

      <Section title="The before-and-after demo">
        <p>
          If you were sent a preview of your store, it was built from the catalogue your storefront already publishes
          to any visitor. Nothing was installed and nothing in your store was changed. The demo is reachable only
          through an unguessable link, is never indexed by search engines, and is deleted automatically once it
          expires.
        </p>
      </Section>

      <Section title="Where your data lives, and for how long">
        <p>
          Your catalogue and your gallery settings are stored on our infrastructure for as long as Sillages is
          installed. Measurement is aggregated for your reporting.
        </p>
        <p>
          When you uninstall, or when Shopify asks us to erase your shop, we delete your catalogue, your gallery and
          its history, every measurement event, every attribution record, every saved product and any preview we
          built for your store.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask us what we hold, ask for a copy, or ask us to delete it, by writing to{' '}
          <a href="mailto:privacy@sillages.app">privacy@sillages.app</a>. Uninstalling the app already triggers
          deletion. We also honour Shopify's mandatory privacy requests automatically.
        </p>
      </Section>

      <Section title="Sub-processors">
        <p>
          Shopify, for your store data and for billing. Our hosting and database providers, which store the data
          described above. We do not sell or rent data to anyone.
        </p>
      </Section>
    </LegalFrame>
  );
}
