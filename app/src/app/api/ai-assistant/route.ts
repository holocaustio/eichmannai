import { NextRequest } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL_ASSISTANT || 'o4-mini';

// Maximum content length to send to the API (approximately 50k tokens worth)
const MAX_CONTENT_LENGTH = 150000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contextType, contextContent, contextTitle, messages, systemPrompt } = body;

    if (!contextType || !contextContent || !messages || !systemPrompt) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Truncate content if too long
    const truncatedContent = contextContent.length > MAX_CONTENT_LENGTH
      ? contextContent.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated due to length...]'
      : contextContent;

    // Build the full system prompt with context
    const fullSystemPrompt = `${systemPrompt}

---

## Document Being Read: ${contextTitle || contextType}

The following is the full text of the document the reader is currently viewing:

<document>
${truncatedContent}
</document>

---

Remember: Base all answers on the document above. If the document does not address a question, say so clearly.

CRITICAL GUARDRAIL: You must ONLY answer questions about this document, the Eichmann Trial, or Holocaust-related context. If asked about ANY other topic (current events, unrelated history, personal advice, technical questions, etc.), politely decline and redirect to the document or trial. Do not attempt to be helpful with off-topic requests.

IMPORTANT: At the end of EVERY response, you MUST include exactly 3 relevant follow-up questions the reader might want to ask. Format them EXACTLY like this (including the separator):

---FOLLOW_UP---
1. First follow-up question?
2. Second follow-up question?
3. Third follow-up question?

The questions should be specific to the content just discussed and encourage deeper exploration of the document.`;

    // Create streaming response
    const stream = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: fullSystemPrompt },
        ...messages
      ],
      stream: true,
      reasoning_effort: 'low',
      max_completion_tokens: 1500
    });

    // Create a readable stream for the response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          }
          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.error(error);
        }
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error) {
    console.error('AI Assistant API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to process request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
