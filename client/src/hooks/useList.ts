import type { InfiniteData } from '@tanstack/react-query';
import type { Page } from '../types/api';

export const flat = <T,>(data?: InfiniteData<Page<T>>): T[] => data?.pages.flatMap((p) => p.items) ?? [];
export const nextOf = <T,>(last: Page<T>) => last.nextCursor ?? undefined;
