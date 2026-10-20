import { useEffect, useState } from 'react';

export type Route =
  | { name: 'landing' }
  | { name: 'rooms' }
  | { name: 'room'; roomId: string }
  | { name: 'join'; token: string };

const NAVIGATE_EVENT = 'codetogether:navigate';

function parse(url: URL): Route {
  // Links generated before rooms had their own URL used ?share=<token>.
  const legacyShare = url.searchParams.get('share');
  if (legacyShare) return { name: 'join', token: legacyShare };

  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] === 'join' && segments[1]) return { name: 'join', token: segments[1] };
  if (segments[0] === 'room' && segments[1]) return { name: 'room', roomId: segments[1] };
  if (segments[0] === 'rooms') return { name: 'rooms' };

  return { name: 'landing' };
}

export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'rooms':
      return '/rooms';
    case 'room':
      return `/room/${route.roomId}`;
    case 'join':
      return `/join/${route.token}`;
    default:
      return '/';
  }
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const path = routeToPath(route);
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);

  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(new URL(window.location.href)));

  useEffect(() => {
    const update = (): void => setRoute(parse(new URL(window.location.href)));

    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATE_EVENT, update);

    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);

  return route;
}
