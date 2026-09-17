/**
 * The way forward.
 *
 * Reported by the merchant: "no vas pasando de pasos tipo next, solo vas
 * navegando por los menús y eso confunde mucho al usuario." The setup strip
 * existed, but no screen offered a continuation, and the Plan screen had no
 * journey context at all.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NextStep } from '../components/gallery/NextStep';
import type { OnboardingProgress } from '../hooks/useGallery';

const progress = (over: Partial<OnboardingProgress> = {}): OnboardingProgress => ({
  catalogueReady: true,
  collectionChosen: true,
  stylePreviewed: true,
  planChosen: true,
  published: false,
  currentStep: 5,
  complete: false,
  ...over,
});

function at(path: string, p: OnboardingProgress) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NextStep progress={p} />
    </MemoryRouter>,
  );
}

describe('every screen in the journey offers the next step', () => {
  it('points a merchant who has chosen a look at their preview', () => {
    at('/design', progress({ stylePreviewed: false, currentStep: 2 }));
    const link = screen.getByRole('link', { name: /see your gallery/i });
    expect(link.getAttribute('href')).toBe('/preview');
  });

  it('points a merchant who has previewed at the plan', () => {
    at('/preview', progress({ planChosen: false, currentStep: 4 }));
    expect(screen.getByRole('link', { name: /choose a plan/i }).getAttribute('href')).toBe('/plan');
  });

  it('gets a merchant off the pricing page and onto their store', () => {
    // The gap that mattered most: pay, then be stranded on a pricing page.
    at('/plan', progress());
    expect(screen.getByRole('link', { name: /put it on your store/i }).getAttribute('href')).toBe('/publish');
  });

  it('sends someone with no catalogue back to the start, not forward', () => {
    at('/design', progress({ catalogueReady: false, collectionChosen: false, stylePreviewed: false, currentStep: 1 }));
    expect(screen.getByRole('link', { name: /sync your catalogue/i }).getAttribute('href')).toBe('/collections');
  });

  it('says nothing on the page that is itself the next step', () => {
    // The page's own buttons are the action; a link to yourself is noise. And
    // it must not claim the gallery is live while publishing is outstanding.
    const { container } = at('/publish', progress());
    expect(container.textContent).toBe('');
  });

  it('says nothing on a screen outside the journey', () => {
    // Performance and the rest keep a forward move once the gallery is live;
    // a page with no onward move defined stays silent rather than inventing one.
    const { container } = at('/somewhere-else', progress({ published: true, complete: true }));
    expect(container.textContent).toBe('');
  });

  it('names the position in the journey, so the strip and the button agree', () => {
    at('/preview', progress({ planChosen: false, currentStep: 4 }));
    expect(screen.getByText(/step 4 of 5/i)).toBeTruthy();
  });

  it('keeps a way forward once the gallery is live', () => {
    // Measured on the live test store: setup complete, the step strip hides
    // itself, and every screen ended with the product list and nothing else.
    // That is the state every successful merchant stays in.
    const live = progress({ published: true, complete: true });

    at('/design', live);
    expect(screen.getByRole('link', { name: /see your gallery/i }).getAttribute('href')).toBe('/preview');
    expect(screen.getByText(/your gallery is live/i)).toBeTruthy();
  });

  it('closes the loop from performance back to the design', () => {
    at('/performance', progress({ published: true, complete: true }));
    expect(screen.getByRole('link', { name: /change how it looks/i }).getAttribute('href')).toBe('/design');
  });

  it('gets a live shop off the pricing page too', () => {
    at('/plan', progress({ published: true, complete: true }));
    expect(screen.getByRole('link', { name: /go to your gallery/i }).getAttribute('href')).toBe('/publish');
  });
});
