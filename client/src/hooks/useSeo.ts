import { useEffect } from 'react';

export const APP_NAME: string = import.meta.env.VITE_APP_NAME ?? 'TeleDesk';
const DEFAULT_DESC = 'TeleDesk : le CRM Telegram des agences — inbox partagée en temps réel, médiathèque PPV, assignation, shifts et métriques par chatter.';

interface Seo { title?: string; description?: string; image?: string; path?: string; type?: 'website' | 'profile' | 'article'; noindex?: boolean; jsonLd?: Record<string, unknown> }

function meta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
}
function link(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  el.href = href;
}

/** Titre, description, Open Graph, Twitter Card, canonical et JSON-LD pour les pages publiques. */
export function useSeo({ title, description = DEFAULT_DESC, image, path, type = 'website', noindex, jsonLd }: Seo) {
  useEffect(() => {
    const full = title ? `${title} · ${APP_NAME}` : APP_NAME;
    const url = `${location.origin}${path ?? location.pathname}`;
    document.title = full;
    meta('name', 'description', description);
    meta('name', 'robots', noindex ? 'noindex' : 'index,follow');
    meta('property', 'og:title', full);
    meta('property', 'og:description', description);
    meta('property', 'og:type', type);
    meta('property', 'og:url', url);
    meta('property', 'og:site_name', APP_NAME);
    meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    meta('name', 'twitter:title', full);
    meta('name', 'twitter:description', description);
    if (image) { const abs = image.startsWith('http') ? image : `${location.origin}${image}`; meta('property', 'og:image', abs); meta('name', 'twitter:image', abs); }
    link('canonical', url);
    let script: HTMLScriptElement | null = null;
    if (jsonLd) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
    return () => { script?.remove(); };
  }, [title, description, image, path, type, noindex, jsonLd]);
}
