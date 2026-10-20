import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';

type Toast = { id: number; message: string; tone: 'info' | 'error' };

const ToastContext = createContext<((message: string, tone?: Toast['tone']) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    nextId.current += 1;
    const id = nextId.current;

    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const icon: IconName = toast.tone === 'error' ? 'warning' : 'check';
          return (
            <div key={toast.id} className={`toast toast-${toast.tone}`}>
              <Icon name={icon} size={14} />
              <span>{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string, tone?: Toast['tone']) => void {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside a ToastProvider.');
  return value;
}
