import { useEffect, useRef } from 'react';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { Button, Spinner } from './ui';

/** Défilement infini : une sentinelle déclenche la page suivante ; le bouton reste le repli clavier / sans IntersectionObserver. */
export function LoadMore({ q, auto = true }: { q: Pick<UseInfiniteQueryResult, 'hasNextPage' | 'isFetchingNextPage' | 'fetchNextPage'>; auto?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    if (!auto || !hasNextPage || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [auto, hasNextPage, isFetchingNextPage, fetchNextPage]);
  if (!hasNextPage) return null;
  return (
    <div ref={ref} className="flex justify-center py-4">
      {isFetchingNextPage ? <Spinner /> : <Button variant="secondary" size="sm" onClick={() => void fetchNextPage()}>Charger plus</Button>}
    </div>
  );
}
