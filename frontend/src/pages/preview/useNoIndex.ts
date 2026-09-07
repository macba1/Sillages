import { useEffect } from 'react';

/**
 * A demo of somebody's store is private by intent. The backend already sends
 * `X-Robots-Tag` on the API, but the page itself is served statically, so it
 * carries its own meta tag too.
 */
export function useNoIndex(): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);
}
