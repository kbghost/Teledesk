import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCan } from '../../stores/auth';
import { useSeo } from '../../hooks/useSeo';
import { cn } from '../../utils/format';
import { ConversationList, defaultFilters, type Filters } from './ConversationList';
import { Thread } from './Thread';
import { SidePanel } from './SidePanel';
import { Icons } from '../../components/icons';

export default function InboxPage() {
  useSeo({ title: 'Inbox', noindex: true });
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const selected = sp.get('c');
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(can('inbox.supervise')));
  const [panel, setPanel] = useState(false);
  const select = (id: string | null) => setSp(id ? { c: id } : {}, { replace: false });

  return (
    <div className="flex h-full min-h-0 bg-surface">
      {/* Colonne Liste des conversations */}
      <section
        aria-label="Conversations"
        className={cn(
          'h-full w-full shrink-0 border-r border-line bg-surface lg:block lg:w-[22rem] xl:w-92 transition-all',
          selected ? 'hidden lg:block' : 'block',
        )}
      >
        <ConversationList
          filters={filters}
          setFilters={setFilters}
          selected={selected}
          onSelect={(id) => {
            select(id);
            setPanel(false);
          }}
        />
      </section>

      {/* Colonne Conversation principale */}
      <section
        aria-label="Conversation"
        className={cn(
          'min-w-0 flex-1 h-full bg-surface',
          !selected ? 'hidden lg:flex flex-col' : 'flex flex-col',
        )}
      >
        {selected ? (
          <Thread
            key={selected}
            id={selected}
            onBack={() => select(null)}
            onTogglePanel={() => setPanel((p) => !p)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted px-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Icons.Messages className="h-8 w-8" aria-hidden />
            </div>
            <h2 className="font-display text-xl font-bold text-ink">Choisissez une conversation</h2>
            <p className="max-w-xs text-sm text-muted">
              Les nouveaux messages de vos contacts Telegram arrivent en temps réel, sans recharger la page.
            </p>
          </div>
        )}
      </section>

      {/* Volet Détails du contact (panneau latéral ou tiroir mobile) */}
      <AnimatePresence>
        {selected && panel && (
          <div className="fixed inset-0 z-40 xl:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/40 backdrop-blur-xs"
              onClick={() => setPanel(false)}
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              className="absolute inset-y-0 right-0 w-full max-w-sm border-l border-line bg-surface shadow-2xl z-10"
            >
              <SidePanel key={selected} id={selected} onClose={() => setPanel(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Détails du contact fixe sur grands écrans (xl+) */}
      {selected && (
        <aside
          aria-label="Détails"
          className="hidden xl:block h-full w-80 shrink-0 border-l border-line bg-surface"
        >
          <SidePanel key={selected} id={selected} onClose={() => setPanel(false)} />
        </aside>
      )}
    </div>
  );
}
