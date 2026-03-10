import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { translations as en } from '../locales/en';
import { translations as es } from '../locales/es';
import type { Translations } from '../locales/en';
import api from '../lib/api';

export type Lang = 'en' | 'es';

const STORAGE_KEY = 'sillages_lang';

function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'es') return stored;
  const browser = navigator.language.toLowerCase();
  return browser.startsWith('es') ? 'es' : 'en';
}

const strings: Record<Lang, Translations> = { en, es };

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const initialLoadDone = useRef(false);

  // On mount, fetch language from server if user is authenticated
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    api.get('/api/accounts/language').then(({ data }) => {
      const serverLang = data.language;
      if (serverLang === 'en' || serverLang === 'es') {
        localStorage.setItem(STORAGE_KEY, serverLang);
        setLangState(serverLang);
      }
    }).catch(() => { /* not authenticated or endpoint error — use local */ });
  }, []);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
    // Persist to server (non-blocking)
    api.patch('/api/accounts/language', { language: l }).catch(() => { /* non-fatal */ });
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string>): string => {
      let str: string = strings[lang][key] ?? strings.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, v);
        }
      }
      return str;
    },
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
