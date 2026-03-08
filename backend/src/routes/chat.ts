import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { openai } from '../lib/openai.js';

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

    const systemPrompt = `You are Sillages, a store intelligence agent. You have just delivered the morning brief for this store. The merchant wants to go deeper on something specific from the brief. Here is today's brief data:

${JSON.stringify(briefData, null, 2)}

STRICT RULES for this chat:
- Only answer questions directly related to this store, these products, and today's brief data
- If asked anything outside of: improving this store, acting on today's data, writing specific copy or content for this store — respond: I can only help with things directly related to our store and today's data.
- Never give generic marketing advice — always reference the specific products, numbers, and situations from the brief
- You can help write: exact email copy, exact social captions, exact product description changes, exact ad copy — always using the real product names and numbers from the brief
- Always respond in ${language === 'es' ? 'Spanish' : 'English'}
- Keep responses short and actionable — this is a quick consultation, not a lecture`;

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
