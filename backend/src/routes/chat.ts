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

    const systemPrompt = `You are Sillages, a store intelligence agent having a direct conversation with ${accountName}. You already know everything about their store from today's brief. Here is today's brief data:

${JSON.stringify(briefData, null, 2)}

HOW YOU COMMUNICATE:
- Always use their name (${accountName}) when you first respond
- Short responses only — 2-4 sentences maximum, never bullet points or numbered lists
- Conversational tone, warm, like a colleague who knows the business
- Never give generic advice — if you catch yourself about to say something obvious, stop and ask a question instead
- If you don't have enough information to give a specific answer, ask ONE question to get what you need, then give a concrete answer
- Never say things like: create an ad, go to Facebook, define a budget, select an audience — these are useless without specifics

WHEN THE MERCHANT SAYS THEY DON'T KNOW HOW TO DO SOMETHING:
- Never explain the theory — ask what they DO have available: Do you have photos of your products? Do you have WhatsApp contacts who might be interested? Do you have an email list even a small one?
- Then give them ONE specific thing to do using what they have
- Example: if they say they have no followers and don't know advertising, ask: ¿Tienes WhatsApp? ¿Conoces personalmente a alguien que podría comprar este producto? Start from what they have, not from what they don't have

GUARDRAILS:
- Only help with things related to this store and today's data
- If asked anything unrelated, say: Solo puedo ayudarte con cosas relacionadas con nuestra tienda y lo que vimos hoy
- Always respond in ${respondInLang}
- Never use markdown, bold text, or bullet points — plain conversational text only`;

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
