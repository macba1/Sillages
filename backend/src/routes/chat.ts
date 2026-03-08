import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { openai } from '../lib/openai.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

// POST /api/chat/brief
// Auth-protected. Receives {messages, briefData, language} from the frontend
// and calls the OpenAI API server-side. Scoped strictly to conversations about the brief.
router.post('/brief', requireAuth, async (req, res, next) => {
  try {
    const { messages, briefData, language } = req.body as {
      messages: { role: 'user' | 'assistant'; content: string }[];
      briefData: Record<string, unknown>;
      language?: string;
    };

    console.log('[chat] Request received', JSON.stringify({ messageCount: messages?.length, hasBreifData: !!briefData, language }));

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new AppError(400, 'messages array is required');
    }
    if (!briefData || typeof briefData !== 'object') {
      throw new AppError(400, 'briefData is required');
    }

    const [{ data: accountRow }, { data: shopConn }] = await Promise.all([
      supabase.from('accounts').select('full_name, email').eq('id', req.accountId!).single(),
      supabase.from('shopify_connections').select('shop_name').eq('account_id', req.accountId!).single(),
    ]);
    const accountName = accountRow?.full_name?.split(' ')[0]
      ?? accountRow?.email?.split('@')[0]
      ?? 'there';

    // Extract real values from briefData to make the example fully concrete
    const brief = briefData as Record<string, unknown>;
    const storeName: string = (shopConn as { shop_name: string | null } | null)?.shop_name ?? 'our store';
    const yesterday = brief.section_yesterday as Record<string, unknown> | undefined;
    const topProduct: string = (yesterday?.top_product as string | undefined) ?? 'our top product';
    const topProductRevenue = (() => {
      const products = (brief.top_products as { revenue?: number; title?: string }[] | undefined);
      const match = products?.find(p => p.title === topProduct);
      return match?.revenue ?? null;
    })();
    const totalOrders = yesterday?.orders as number | undefined;

    const respondInLang = language === 'es' ? 'Spanish' : 'English';

    const systemPrompt = `You are Sillages. You are part of this business — always say WE, OUR, US. Never say YOUR store, YOUR products, YOUR customers. We are a team.

You have full context about our store from today's brief. Here it is:

${JSON.stringify(briefData, null, 2)}

Store name: ${storeName}
Top product today: ${topProduct}${topProductRevenue ? ` (€${topProductRevenue.toFixed(2)} revenue yesterday)` : ''}
Total orders yesterday: ${totalOrders ?? 'see brief data'}

CRITICAL RULES:
Never use the merchant's name more than once — only in the very first reply if at all. Never again after that.
Never say YOUR store, YOUR products — always OUR store, OUR products.
Never suggest creating ads, going to Facebook, setting a budget, or anything that requires money or technical setup. These are useless without specifics.
When someone says they don't know advertising, immediately ask: ¿Tienes WhatsApp? ¿Tienes una lista de emails aunque sea pequeña? — then use their answer to write something concrete.
When suggesting any message, email, caption, or content — write the exact text using real values. Never describe what to write. Write it.

WRONG response: "Te recomiendo enviar un mensaje a tus contactos sobre tus productos"
RIGHT response: "¿Tienes WhatsApp? Manda este mensaje ahora a 10 personas que conozcas: Hola! En ${storeName} acabamos de preparar nuestra ${topProduct}. Si quieres una para este finde dime y te la reservo. — corto, directo, sin presión."

Always use: ${storeName}, ${topProduct}, and real numbers from the brief. Never use placeholders like [product name] or [price] — use the actual values.
If you need one more detail from the merchant to make it concrete, ask exactly one question, then write the content.

Respond in ${respondInLang}. Plain text only, no bullet points, no bold, no markdown. Max 4 sentences per response.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    });

    const reply = completion.choices[0]?.message?.content ?? '';
    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

export default router;
