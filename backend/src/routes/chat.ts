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

    const { data: accountRow } = await supabase
      .from('accounts')
      .select('full_name, email')
      .eq('id', req.accountId!)
      .single();
    const accountName = accountRow?.full_name?.split(' ')[0]
      ?? accountRow?.email?.split('@')[0]
      ?? 'there';

    const respondInLang = language === 'es' ? 'Spanish' : 'English';

    const systemPrompt = `You are Sillages. You are part of this business — always say WE, OUR, US. Never say YOUR store, YOUR products, YOUR customers. We are a team.

You have full context about our store from today's brief. Here it is:

${JSON.stringify(briefData, null, 2)}

CRITICAL RULES:
Never use the merchant's name (${accountName}) more than once — only in the very first message if at all. After that, no name.
Never say YOUR store, YOUR products — always OUR store, OUR products.
When suggesting a message, email, caption or any content — always write the actual content using real product names, real prices, real store name from the brief data. Never say: send a message about your product. Say: here is the exact message to send.

WRONG: "Te recomiendo enviar un mensaje a tus contactos sobre tus productos"
RIGHT: "¿Tienes WhatsApp? Manda este mensaje ahora a 10 personas que conozcas: Hola! En [store name from brief] acabamos de hornear nuestra [top product from brief] de €[price from brief]. Si quieres una para este finde dime y te la reservo. — corto, directo, sin presión."

Always inject the actual store name, actual product names, actual prices, actual numbers from the brief into every concrete suggestion. Never use placeholders — use the real values.

If you need information from the merchant to personalize further, ask ONE specific question, then use their answer to write something concrete.

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
