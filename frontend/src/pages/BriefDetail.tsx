import { useParams, Link } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Send, X } from 'lucide-react';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { useBrief } from '../hooks/useBriefs';
import { useLanguage } from '../contexts/LanguageContext';
import api from '../lib/api';
import type { IntelligenceBrief } from '../types/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap dollar amounts in gold spans. */
function Gold({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--gold)', fontWeight: 500 }}>{children}</span>;
}

function HighlightNumbers({ text }: { text: string }) {
  const parts = text.split(/(\$[\d,]+(?:\.\d+)?)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('$') ? <Gold key={i}>{part}</Gold> : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ── Brief section wrapper ─────────────────────────────────────────────────────

function BriefSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(201,150,74,0.2)' }} />
      </div>
      {children}
    </section>
  );
}

// ── Brief conversation ────────────────────────────────────────────────────────

function BriefBody({ brief, t }: { brief: IntelligenceBrief; t: ReturnType<typeof useLanguage>['t'] }) {
  const w   = brief.section_whats_working;
  const n   = brief.section_whats_not_working;
  const sig = brief.section_signal;
  const gap = brief.section_gap;
  const act = brief.section_activation;

  return (
    <div>
      {/* What worked */}
      {w && w.items.length > 0 && (
        <BriefSection label={t('brief.section.worked')}>
          <div className="flex flex-col" style={{ gap: 20 }}>
            {w.items.map((item, i) => (
              <p key={i} style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.7 }}>
                <span style={{ fontWeight: 600 }}>{item.title}</span>
                {' — '}
                <Gold>{item.metric}</Gold>
                {'. '}
                <HighlightNumbers text={item.insight} />
              </p>
            ))}
          </div>
        </BriefSection>
      )}

      {/* What didn't */}
      {n && n.items.length > 0 && (
        <BriefSection label={t('brief.section.notWorked')}>
          <div className="flex flex-col" style={{ gap: 20 }}>
            {n.items.map((item, i) => (
              <p key={i} style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.7 }}>
                <span style={{ fontWeight: 600 }}>{item.title}</span>
                {' — '}
                <Gold>{item.metric}</Gold>
                {'. '}
                <HighlightNumbers text={item.insight} />
              </p>
            ))}
          </div>
        </BriefSection>
      )}

      {/* Signal */}
      {sig && (
        <BriefSection label={t('brief.section.watching')}>
          <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 14 }}>
            {sig.headline}
          </p>
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.75, marginBottom: 10 }}>
            {sig.market_context}
          </p>
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.75 }}>
            {sig.store_implication}
          </p>
        </BriefSection>
      )}

      {/* Gap */}
      {gap && (
        <BriefSection label={t('brief.section.gap')}>
          <p style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.75, marginBottom: 10 }}>
            <HighlightNumbers text={gap.gap} />
          </p>
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.75, marginBottom: 14 }}>
            <HighlightNumbers text={gap.opportunity} />
          </p>
          <p style={{ fontSize: 14, color: 'var(--ink-muted)' }}>
            {t('brief.upside')} <Gold>{gap.estimated_upside}</Gold>
          </p>
        </BriefSection>
      )}

      {/* Activation */}
      {act && (
        <BriefSection label={t('brief.section.activation')}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: 24 }}>
            <p
              className="font-display"
              style={{ fontSize: 22, color: 'var(--ink)', lineHeight: 1.3, marginBottom: 12 }}
            >
              {act.what}
            </p>
            <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.75, marginBottom: 20 }}>
              {act.why}
            </p>
            <ol style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {act.how.map((step, i) => (
                <li key={i} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13, flexShrink: 0, paddingTop: 2 }}>
                    {i + 1}.
                  </span>
                  <span style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.65 }}>{step}</span>
                </li>
              ))}
            </ol>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
              {t('brief.expected')} <Gold>{act.expected_impact}</Gold>
            </p>
          </div>
        </BriefSection>
      )}

      {/* Footer */}
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', paddingTop: 8 }}>
        {t('brief.footer')}
      </p>
    </div>
  );
}

// ── Chat panel ────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const GREETING: Record<'en' | 'es', string> = {
  es: 'Hola. Estoy aquí para ayudarte a actuar sobre lo que vimos hoy. Puedes preguntarme cómo escribir el email, qué poner en el post, cómo cambiar la descripción del producto — lo que necesites para ejecutar el experimento de hoy.',
  en: "Hi. I'm here to help you act on what we saw today. Ask me how to write the email, what to post, how to change the product description — whatever you need to execute today's experiment.",
};

function ChatPanel({ brief, lang, onClose }: { brief: IntelligenceBrief; lang: 'en' | 'es'; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post('/api/chat/brief', { messages: next, briefData: brief, language: lang });
      setMessages([...next, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages([...next, { role: 'assistant', content: lang === 'es' ? 'Algo salió mal. Intenta de nuevo.' : 'Something went wrong. Try again.' }]);
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

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      background: '#FAF6F1',
      borderTop: '1px solid rgba(201,150,74,0.25)',
      boxShadow: '0 -8px 32px rgba(58,35,50,0.12)',
      maxHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: '1px solid rgba(201,150,74,0.15)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Sillages
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, display: 'flex', alignItems: 'center' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Greeting — always shown, not sent to API */}
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <div style={{
            maxWidth: '82%',
            padding: '10px 14px',
            borderRadius: '14px 14px 14px 4px',
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
              maxWidth: '82%',
              padding: '10px 14px',
              borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
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
            <div style={{ padding: '10px 14px', borderRadius: '14px 14px 14px 4px', background: '#FFFFFF', border: '1px solid rgba(201,150,74,0.2)', fontSize: 14, color: 'var(--ink-faint)' }}>
              …
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        display: 'flex',
        gap: 10,
        padding: '12px 16px',
        borderTop: '1px solid rgba(201,150,74,0.15)',
        flexShrink: 0,
        background: '#FAF6F1',
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about today's data…"
          autoFocus
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid rgba(201,150,74,0.3)',
            background: '#FFFFFF',
            fontSize: 14,
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
            borderRadius: 10,
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
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function BriefDetail() {
  const { id } = useParams<{ id: string }>();
  const { brief, loading, error } = useBrief(id);
  const { t } = useLanguage();
  const { lang } = useLanguage();
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <AppShell>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '64px 32px 80px' }}>

        {/* Back link */}
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2"
          style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)', textDecoration: 'none', marginBottom: 40, transition: 'color 0.15s' }}
        >
          <ArrowLeft size={12} />
          {t('brief.back')}
        </Link>

        {loading && (
          <div className="flex justify-center" style={{ paddingTop: 48 }}>
            <Spinner size="lg" />
          </div>
        )}

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: 16, fontSize: 14, color: '#DC2626' }}>
            {error}
          </div>
        )}

        {!loading && brief && (
          <>
            {/* Header */}
            <div style={{ marginBottom: 40 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 12 }}>
                {format(parseISO(brief.brief_date), 'EEEE, MMMM d · yyyy')}
              </p>

              {/* Headline from yesterday's summary */}
              {brief.section_yesterday?.summary && (
                <h1
                  className="font-display fade-up"
                  style={{ fontSize: 36, color: 'var(--ink)', lineHeight: 1.2, marginBottom: 0 }}
                >
                  {brief.section_yesterday.summary}
                </h1>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(201,150,74,0.2)', marginBottom: 48 }} />

            <BriefBody brief={brief} t={t} />

            {/* Deepen chat button */}
            <div style={{ paddingTop: 16, paddingBottom: chatOpen ? 0 : 8 }}>
              <button
                onClick={() => setChatOpen(o => !o)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'none',
                  border: '1px solid rgba(201,150,74,0.35)',
                  borderRadius: 10,
                  padding: '12px 20px',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--gold)',
                  fontFamily: "'DM Sans', sans-serif",
                  transition: 'border-color 0.15s, background 0.15s',
                  width: '100%',
                  justifyContent: 'center',
                }}
              >
                Profundizar con Sillages →
              </button>
            </div>
          </>
        )}
      </div>

      {chatOpen && brief && <ChatPanel brief={brief} lang={lang} onClose={() => setChatOpen(false)} />}
    </AppShell>
  );
}
