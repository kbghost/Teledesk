import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Overlay';

interface Ask { title: string; text?: string; confirmLabel?: string; danger?: boolean }
const Ctx = createContext<(a: Ask) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

/** Confirmation promise-based : `if (await confirm({ title: 'Supprimer ?' })) …` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<(v: boolean) => void>();
  const confirm = useCallback((a: Ask) => new Promise<boolean>((res) => { resolver.current = res; setAsk(a); }), []);
  const close = (v: boolean) => { resolver.current?.(v); setAsk(null); };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal open={!!ask} onClose={() => close(false)} title={ask?.title} size="sm" hideClose
        footer={<><Button variant="secondary" onClick={() => close(false)}>Annuler</Button><Button variant={ask?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{ask?.confirmLabel ?? 'Confirmer'}</Button></>}>
        {ask?.text && <p className="text-sm text-muted">{ask.text}</p>}
      </Modal>
    </Ctx.Provider>
  );
}
