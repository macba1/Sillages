import { useState, useEffect } from 'react';
import api from '../lib/api';

type Rating = 'useful' | 'not_useful' | 'want_more';
type Topic = 'customers' | 'social_media' | 'products' | 'competition';

interface FeedbackData {
  rating: Rating;
  want_more_topic?: Topic | null;
  free_text?: string | null;
}

type Step = 'initial' | 'not_useful_text' | 'want_more_topic' | 'done';

const TOPIC_LABELS: Record<Topic, string> = {
  customers: 'Mas datos de mis clientes',
  social_media: 'Mas ideas para redes sociales',
  products: 'Mas sobre mis productos',
  competition: 'Mas sobre mi competencia',
};

const RATING_LABELS: Record<Rating, string> = {
  useful: 'Util',
  not_useful: 'No mucho',
  want_more: 'Quiero mas de esto',
};

export function BriefFeedback({ briefId }: { briefId: string }) {
  const [step, setStep] = useState<Step>('initial');
  const [existingFeedback, setExistingFeedback] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [freeText, setFreeText] = useState('');
  // Check for existing feedback on mount
  useEffect(() => {
    api
      .get(`/api/briefs/${briefId}/feedback`)
      .then(({ data }) => {
        if (data.feedback) {
          setExistingFeedback(data.feedback);
          setStep('done');
        }
      })
      .catch(() => {
        // ignore — just show the form
      })
      .finally(() => setLoading(false));
  }, [briefId]);

  async function submit(payload: FeedbackData) {
    setSubmitting(true);
    try {
      await api.post(`/api/briefs/${briefId}/feedback`, payload);
      setExistingFeedback(payload);
      setStep('done');
    } catch {
      // silently fail — non-critical
    } finally {
      setSubmitting(false);
    }
  }

  function handleRating(rating: Rating) {
    if (rating === 'useful') {
      submit({ rating });
    } else if (rating === 'not_useful') {
      setStep('not_useful_text');
    } else {
      setStep('want_more_topic');
    }
  }

  function handleTopicSelect(topic: Topic) {
    submit({ rating: 'want_more', want_more_topic: topic });
  }

  function handleFreeTextSubmit() {
    submit({ rating: 'not_useful', free_text: freeText || null });
  }

  if (loading) return null;

  // Already submitted state
  if (step === 'done') {
    const fb = existingFeedback;
    return (
      <div style={containerStyle}>
        <p style={{ fontSize: 14, color: 'var(--ink-muted)', textAlign: 'center' }}>
          Gracias por tu feedback
        </p>
        {fb && (
          <p style={{ fontSize: 13, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 6 }}>
            {RATING_LABELS[fb.rating]}
            {fb.want_more_topic ? ` — ${TOPIC_LABELS[fb.want_more_topic]}` : ''}
            {fb.free_text ? ` — "${fb.free_text}"` : ''}
          </p>
        )}
      </div>
    );
  }

  // Initial rating buttons
  if (step === 'initial') {
    return (
      <div style={containerStyle}>
        <p style={{ fontSize: 14, color: 'var(--ink)', textAlign: 'center', marginBottom: 16, fontWeight: 500 }}>
          Que te parecio el brief de hoy?
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <FeedbackButton onClick={() => handleRating('useful')} disabled={submitting}>
            Util
          </FeedbackButton>
          <FeedbackButton onClick={() => handleRating('not_useful')} disabled={submitting}>
            No mucho
          </FeedbackButton>
          <FeedbackButton onClick={() => handleRating('want_more')} disabled={submitting}>
            Quiero mas de esto
          </FeedbackButton>
        </div>
      </div>
    );
  }

  // Not useful — free text
  if (step === 'not_useful_text') {
    return (
      <div style={containerStyle}>
        <p style={{ fontSize: 14, color: 'var(--ink)', textAlign: 'center', marginBottom: 16, fontWeight: 500 }}>
          Que te gustaria ver?
        </p>
        <div style={{ display: 'flex', gap: 10, maxWidth: 400, margin: '0 auto' }}>
          <input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFreeTextSubmit();
            }}
            placeholder="Escribe aqui..."
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
            onClick={handleFreeTextSubmit}
            disabled={submitting}
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              background: 'var(--gold)',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.6 : 1,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Enviar
          </button>
        </div>
      </div>
    );
  }

  // Want more — topic pills
  if (step === 'want_more_topic') {
    return (
      <div style={containerStyle}>
        <p style={{ fontSize: 14, color: 'var(--ink)', textAlign: 'center', marginBottom: 16, fontWeight: 500 }}>
          Que quieres ver mas?
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {(Object.entries(TOPIC_LABELS) as [Topic, string][]).map(([topic, label]) => (
            <FeedbackButton
              key={topic}
              onClick={() => handleTopicSelect(topic)}
              disabled={submitting}
            >
              {label}
            </FeedbackButton>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// -- Shared styles & sub-components --

const containerStyle: React.CSSProperties = {
  marginTop: 40,
  padding: '28px 24px',
  background: 'var(--white)',
  borderRadius: 16,
  border: '1px solid rgba(201,150,74,0.15)',
};

function FeedbackButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 18px',
        borderRadius: 10,
        border: '1px solid rgba(201,150,74,0.35)',
        background: 'none',
        color: 'var(--gold)',
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: "'DM Sans', sans-serif",
        transition: 'background 0.15s, border-color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}
