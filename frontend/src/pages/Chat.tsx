import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';
import { useLanguage } from '../contexts/LanguageContext';
import api from '../lib/api';
import type { IntelligenceBrief } from '../types/index';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const GREETING: Record<'en' | 'es', string> = {
  es: 'Hola. Estoy aquí para ayudarte a actuar sobre lo que vimos hoy. Puedes preguntarme cómo escribir el email, qué poner en el post, cómo cambiar la descripción del producto — lo que necesites.',
  en: "Hi. I'm here to help you act on what we saw today. Ask me how to write the email, what to post, how to change the product description — whatever you need.",
};

export default function Chat() {
  const { account } = useAccount();
  const { briefs, loading: briefsLoading } = useBriefs(account?.id);
  const { lang } = useLanguage();
  const latest: IntelligenceBrief | null = briefs[0] ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading || !latest) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post('/api/chat/brief', {
        messages: next,
        briefData: latest,
        language: lang,
      });
      setMessages([...next, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: lang === 'es' ? 'Algo salió mal. Intenta de nuevo.' : 'Something went wrong. Try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (briefsLoading) {
    return (
      <AppShell>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', paddingBottom: 80 }}>
          <Spinner size="lg" />
        </div>
      </AppShell>
    );
  }

  if (!latest) {
    return (
      <AppShell>
        <div style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          height: '100%', paddingBottom: 80, padding: '40px 24px', textAlign: 'center',
        }}>
          <p style={{ fontSize: 16, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
            {lang === 'es'
              ? 'Tu primer brief aún no está listo. El chat estará disponible cuando tengas un brief generado.'
              : "Your first brief isn't ready yet. Chat will be available once you have a generated brief."}
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(201,150,74,0.15)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Sillages</span>
        <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginLeft: 8 }}>
          {lang === 'es' ? 'Tu asistente' : 'Your assistant'}
        </span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        WebkitOverflowScrolling: 'touch',
      }}>
        {/* Greeting */}
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <div style={{
            maxWidth: '85%',
            padding: '10px 14px',
            borderRadius: '16px 16px 16px 4px',
            background: '#FFFFFF',
            color: 'var(--ink)',
            fontSize: 14,
            lineHeight: 1.6,
            border: '1px solid rgba(201,150,74,0.2)',
          }}>
            {GREETING[lang]}
          </div>
        </div>

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: m.role === 'user' ? 'var(--gold)' : '#FFFFFF',
              color: m.role === 'user' ? '#FFF' : 'var(--ink)',
              fontSize: 14,
              lineHeight: 1.6,
              border: m.role === 'assistant' ? '1px solid rgba(201,150,74,0.2)' : 'none',
              whiteSpace: 'pre-wrap',
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '10px 14px',
              borderRadius: '16px 16px 16px 4px',
              background: '#FFFFFF',
              border: '1px solid rgba(201,150,74,0.2)',
              fontSize: 14,
              color: 'var(--ink-faint)',
            }}>
              …
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '12px 16px',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        borderTop: '1px solid rgba(201,150,74,0.15)',
        flexShrink: 0,
        background: 'rgba(250,246,241,0.95)',
        backdropFilter: 'blur(10px)',
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={lang === 'es' ? 'Pregunta sobre tus datos…' : "Ask about today's data…"}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 20,
            border: '1px solid rgba(201,150,74,0.3)',
            background: '#FFFFFF',
            fontSize: 15,
            color: 'var(--ink)',
            outline: 'none',
            fontFamily: "'DM Sans', sans-serif",
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            background: input.trim() && !loading ? 'var(--gold)' : 'rgba(201,150,74,0.3)',
            border: 'none',
            cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
        >
          <Send size={16} color="#FFFFFF" />
        </button>
      </div>
    </div>
    </AppShell>
  );
}
