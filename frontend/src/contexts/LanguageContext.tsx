import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { translations as en } from '../locales/en';
import { translations as es } from '../locales/es';
import type { Translations } from '../locales/en';
import api from '../lib/api';
import { supabase } from '../lib/supabase';

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

  // On mount, fetch the language from the server — but only for someone who
  // has an account to fetch it for.
  //
  // This provider wraps the whole app, so the request also fired on every
  // public page: the landing page, the privacy and terms pages, and the shared
  // picks page a shopper's friend opens. With no session that is a 401 in the
  // visitor's console and a wasted round trip on the page the whole sharing
  // feature exists to produce. The comment here always said "if authenticated";
  // the code never checked.
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    let cancelled = false;
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (cancelled || !session.session) return;

      try {
        const { data } = await api.get('/api/accounts/language');
        const serverLang = data.language;
        if (!cancelled && (serverLang === 'en' || serverLang === 'es')) {
          localStorage.setItem(STORAGE_KEY, serverLang);
          setLangState(serverLang);
        }
      } catch {
        // Endpoint error: the locally detected language is a fine answer.
      }
    })();

    return () => {
      cancelled = true;
    };
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
