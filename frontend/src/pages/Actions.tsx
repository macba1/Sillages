import { useState } from 'react';
import { AppShell } from '../components/layout/LeftNav';
import { useAccount } from '../hooks/useAccount';
import { useActions, type PendingAction } from '../hooks/useActions';
import { useLanguage } from '../contexts/LanguageContext';
import { Spinner } from '../components/ui/Spinner';
import {
  Instagram,
  Tag,
  Mail,
  ShoppingBag,
  Search,
  MessageCircle,
  Check,
  X,
  Pencil,
  ChevronDown,
  ChevronUp,
  Clock,
  Zap,
} from 'lucide-react';

const TYPE_ICONS: Record<string, typeof Instagram> = {
  instagram_post: Instagram,
  discount_code: Tag,
  email_campaign: Mail,
  product_highlight: ShoppingBag,
  seo_fix: Search,
  whatsapp_message: MessageCircle,
};

const TYPE_LABELS: Record<string, Record<string, string>> = {
  instagram_post:    { en: 'Instagram Post',     es: 'Post de Instagram' },
  discount_code:     { en: 'Discount Code',       es: 'Código de Descuento' },
  email_campaign:    { en: 'Email Campaign',      es: 'Campaña de Email' },
  product_highlight: { en: 'Product Highlight',   es: 'Destacar Producto' },
  seo_fix:           { en: 'SEO Fix',             es: 'Corrección SEO' },
  whatsapp_message:  { en: 'WhatsApp Message',    es: 'Mensaje WhatsApp' },
};

function approveLabel(type: string, lang: string): string {
  const labels: Record<string, Record<string, string>> = {
    discount_code:     { en: 'Create discount', es: 'Crear descuento' },
    seo_fix:           { en: 'Apply fix',       es: 'Aplicar corrección' },
    product_highlight: { en: 'Move product',    es: 'Mover producto' },
    instagram_post:    { en: 'Copy text',       es: 'Copiar texto' },
    email_campaign:    { en: 'Send email',      es: 'Enviar email' },
    whatsapp_message:  { en: 'Open WhatsApp',   es: 'Abrir WhatsApp' },
  };
  return labels[type]?.[lang] ?? (lang === 'es' ? 'Ejecutar' : 'Execute');
}

const PRIORITY_COLORS: Record<string, string> = {
  high: '#D35400',
  medium: '#C9964A',
  low: '#A89880',
};

export default function Actions() {
  const { account } = useAccount();
  const { actions, history, loading, error, approve, reject, editAction } = useActions(account?.id);
  const { t, lang } = useLanguage();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [feedback, setFeedback] = useState<{ id: string; msg: string; ok: boolean } | null>(null);

  const handleApprove = async (action: PendingAction) => {
    setProcessing(action.id);
    try {
      const result = await approve(action.id);
      const updatedAction = result.action;
      const actionResult = updatedAction?.result as Record<string, unknown> | null;

      if (updatedAction?.status === 'failed') {
        const errMsg = (actionResult?.error as string) ?? (lang === 'es' ? 'Error al ejecutar' : 'Execution failed');
        setFeedback({ id: action.id, msg: errMsg, ok: false });
      } else if (result.executed) {
        // Type-specific success messages
        if (action.type === 'instagram_post') {
          // Copy the post text to clipboard
          const copy = actionResult?.copy as string;
          if (copy) {
            try { await navigator.clipboard.writeText(copy); } catch { /* fallback ok */ }
          }
          setFeedback({ id: action.id, msg: lang === 'es' ? 'Copy listo. Abre Instagram y pégalo.' : 'Copy ready. Open Instagram and paste it.', ok: true });
        } else if (action.type === 'whatsapp_message') {
          const waLink = actionResult?.wa_link as string;
          if (waLink) window.open(waLink, '_blank');
          setFeedback({ id: action.id, msg: lang === 'es' ? 'Enlace de WhatsApp abierto' : 'WhatsApp link opened', ok: true });
        } else if (action.type === 'email_campaign') {
          const sent = (actionResult?.total_sent as number) ?? 0;
          setFeedback({ id: action.id, msg: lang === 'es' ? `Email enviado a ${sent} contacto(s)` : `Email sent to ${sent} contact(s)`, ok: true });
        } else if (action.type === 'product_highlight') {
          const collection = (actionResult?.collection as string) ?? '';
          setFeedback({ id: action.id, msg: lang === 'es' ? `Producto movido a posición 1 en "${collection}"` : `Product moved to position 1 in "${collection}"`, ok: true });
        } else {
          setFeedback({ id: action.id, msg: lang === 'es' ? 'Ejecutado en Shopify' : 'Executed on Shopify', ok: true });
        }
      } else {
        setFeedback({ id: action.id, msg: lang === 'es' ? 'Aprobado' : 'Approved', ok: true });
      }
      setTimeout(() => setFeedback(null), 5000);
    } catch {
      setFeedback({ id: action.id, msg: lang === 'es' ? 'Error al aprobar' : 'Failed to approve', ok: false });
      setTimeout(() => setFeedback(null), 5000);
    }
    setProcessing(null);
  };

  const handleReject = async (action: PendingAction) => {
    const confirmMsg = lang === 'es' ? '¿Descartar esta acción?' : 'Discard this action?';
    if (!confirm(confirmMsg)) return;
    setProcessing(action.id);
    try {
      await reject(action.id);
    } catch { /* ignore */ }
    setProcessing(null);
  };

  const handleEdit = (action: PendingAction) => {
    setEditingId(action.id);
    setEditContent(action.content?.copy as string ?? action.content?.discount_code as string ?? '');
  };

  const handleSaveEdit = async (action: PendingAction) => {
    setProcessing(action.id);
    try {
      const updatedContent = { ...action.content };
      if (action.type === 'discount_code') {
        updatedContent.discount_code = editContent;
      } else {
        updatedContent.copy = editContent;
      }
      await editAction(action.id, updatedContent);
      setEditingId(null);
    } catch { /* ignore */ }
    setProcessing(null);
  };

  return (
    <AppShell>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px 100px' }}>
        {/* Header */}
        <div className="fade-up" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Zap size={20} style={{ color: '#C9964A' }} />
            <h1
              className="font-display"
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              {t('actions.title')}
            </h1>
          </div>
          <p style={{ color: 'var(--ink-muted)', fontSize: 14, margin: 0 }}>
            {t('actions.subtitle')}
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
            <Spinner size="lg" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '16px 20px',
            borderRadius: 12,
            background: 'rgba(211,84,0,0.08)',
            color: '#D35400',
            fontSize: 14,
          }}>
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && actions.length === 0 && (
          <div
            className="fade-up"
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              background: 'rgba(201,150,74,0.06)',
              borderRadius: 16,
              border: '1px solid rgba(201,150,74,0.12)',
            }}
          >
            <Zap size={32} style={{ color: '#C9964A', marginBottom: 12 }} />
            <p style={{ color: 'var(--ink)', fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>
              {t('actions.empty.title')}
            </p>
            <p style={{ color: 'var(--ink-muted)', fontSize: 13, margin: 0 }}>
              {t('actions.empty.body')}
            </p>
          </div>
        )}

        {/* Pending Actions */}
        {!loading && actions.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            lang={lang}
            expanded={expandedId === action.id}
            editing={editingId === action.id}
            editContent={editContent}
            processing={processing === action.id}
            feedback={feedback?.id === action.id ? feedback : null}
            onToggle={() => setExpandedId(expandedId === action.id ? null : action.id)}
            onApprove={() => handleApprove(action)}
            onReject={() => handleReject(action)}
            onEdit={() => handleEdit(action)}
            onEditChange={setEditContent}
            onSaveEdit={() => handleSaveEdit(action)}
            onCancelEdit={() => setEditingId(null)}
          />
        ))}

        {/* History */}
        {!loading && history.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink-muted)',
                fontSize: 13,
                fontWeight: 600,
                padding: '8px 0',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {t('actions.history')} ({history.length})
            </button>

            {showHistory && history.map(action => (
              <HistoryRow key={action.id} action={action} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ActionCard({
  action,
  lang,
  expanded,
  editing,
  editContent,
  processing,
  feedback,
  onToggle,
  onApprove,
  onReject,
  onEdit,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
}: {
  action: PendingAction;
  lang: string;
  expanded: boolean;
  editing: boolean;
  editContent: string;
  processing: boolean;
  feedback: { msg: string; ok: boolean } | null;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onEditChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  const Icon = TYPE_ICONS[action.type] ?? Zap;
  const typeLabel = TYPE_LABELS[action.type]?.[lang] ?? action.type;
  const priority = (action.content?.priority as string) ?? 'medium';
  const timeEstimate = (action.content?.time_estimate as string) ?? '';
  const copy = (action.content?.copy as string) ?? '';
  const discountCode = (action.content?.discount_code as string) ?? '';
  const discountPct = action.content?.discount_percentage as number | undefined;

  return (
    <div
      className="fade-up"
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: '18px 20px',
        marginBottom: 12,
        border: '1px solid rgba(201,150,74,0.12)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}
      >
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'rgba(201,150,74,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={18} style={{ color: '#C9964A' }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: PRIORITY_COLORS[priority],
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {priority}
            </span>
            <span style={{
              fontSize: 10,
              color: 'var(--ink-faint)',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {typeLabel}
            </span>
          </div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
            {action.title}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.4 }}>
            {action.description}
          </p>
        </div>

        <ChevronDown
          size={16}
          style={{
            color: 'var(--ink-faint)',
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(180deg)' : 'none',
            flexShrink: 0,
            marginTop: 4,
          }}
        />
      </div>

      {/* Time estimate badge */}
      {timeEstimate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, marginLeft: 48 }}>
          <Clock size={12} style={{ color: 'var(--ink-faint)' }} />
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{timeEstimate}</span>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div style={{ marginTop: 14, marginLeft: 48, paddingTop: 14, borderTop: '1px solid rgba(201,150,74,0.08)' }}>
          {/* Copy preview */}
          {copy && !editing && (
            <div style={{
              background: 'rgba(201,150,74,0.05)',
              borderRadius: 10,
              padding: '12px 14px',
              fontSize: 13,
              color: 'var(--ink)',
              lineHeight: 1.5,
              marginBottom: 12,
              whiteSpace: 'pre-wrap',
            }}>
              {copy}
            </div>
          )}

          {/* Discount info */}
          {action.type === 'discount_code' && !editing && (
            <div style={{
              background: 'rgba(201,150,74,0.05)',
              borderRadius: 10,
              padding: '12px 14px',
              fontSize: 13,
              marginBottom: 12,
            }}>
              <div style={{ color: 'var(--ink-muted)', marginBottom: 4 }}>
                {lang === 'es' ? 'Código' : 'Code'}: <strong style={{ color: 'var(--ink)' }}>{discountCode}</strong>
              </div>
              {discountPct && (
                <div style={{ color: 'var(--ink-muted)' }}>
                  {lang === 'es' ? 'Descuento' : 'Discount'}: <strong style={{ color: 'var(--ink)' }}>{discountPct}%</strong>
                </div>
              )}
            </div>
          )}

          {/* Edit mode */}
          {editing && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={editContent}
                onChange={e => onEditChange(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 80,
                  borderRadius: 10,
                  border: '1px solid rgba(201,150,74,0.2)',
                  padding: '10px 12px',
                  fontSize: 13,
                  fontFamily: "'DM Sans', sans-serif",
                  resize: 'vertical',
                  background: '#fff',
                  color: 'var(--ink)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={onSaveEdit} disabled={processing} style={btnStyle('#C9964A', '#fff')}>
                  {lang === 'es' ? 'Guardar' : 'Save'}
                </button>
                <button onClick={onCancelEdit} style={btnStyle('transparent', 'var(--ink-muted)', true)}>
                  {lang === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
              </div>
            </div>
          )}

          {/* Feedback toast */}
          {feedback && (
            <div style={{
              padding: '8px 12px',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13,
              fontWeight: 600,
              background: feedback.ok ? 'rgba(39,174,96,0.1)' : 'rgba(211,84,0,0.1)',
              color: feedback.ok ? '#27AE60' : '#D35400',
            }}>
              {feedback.msg}
            </div>
          )}

          {/* Action buttons */}
          {!editing && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={onApprove}
                disabled={processing}
                style={btnStyle('#C9964A', '#fff')}
              >
                <Check size={14} />
                {approveLabel(action.type, lang)}
              </button>
              <button onClick={onEdit} style={btnStyle('rgba(201,150,74,0.1)', '#C9964A')}>
                <Pencil size={14} />
              </button>
              <button onClick={onReject} style={btnStyle('rgba(211,84,0,0.08)', '#D35400')}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ action, lang }: { action: PendingAction; lang: string }) {
  const Icon = TYPE_ICONS[action.type] ?? Zap;
  const statusColor = action.status === 'completed' ? '#27AE60' : '#A89880';
  const statusLabel = action.status === 'completed'
    ? (lang === 'es' ? 'Completado' : 'Completed')
    : (lang === 'es' ? 'Descartado' : 'Rejected');

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 0',
      borderBottom: '1px solid rgba(201,150,74,0.06)',
    }}>
      <Icon size={16} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{action.title}</span>
      </div>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        color: statusColor,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        {statusLabel}
      </span>
    </div>
  );
}

function btnStyle(bg: string, color: string, outline = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    border: outline ? '1px solid rgba(201,150,74,0.2)' : 'none',
    background: bg,
    color,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  };
}
