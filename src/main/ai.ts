import { CopilotClient, CopilotSession, approveAll } from '@github/copilot-sdk';

export interface ParsedIntent {
  description: string;
  client: string | null;
  due_at: string | null;
}

let client: CopilotClient | null = null;
let session: CopilotSession | null = null;

const SYSTEM_MESSAGE = `You are an intent parser. Given a natural language intent, extract structured fields.
Return ONLY a JSON object with these fields (no markdown, no explanation):
- "description": a clean, concise action description
- "client": the client/company name if mentioned, otherwise null
- "due_at": a human-readable due date/time if mentioned, otherwise null

Examples:
Input: "make a powerpoint deck for Acme by Friday"
Output: {"description":"Create PowerPoint deck","client":"Acme","due_at":"Friday"}

Input: "review the PR"
Output: {"description":"Review the PR","client":null,"due_at":null}

Input: "send invoice to Contoso before end of month"
Output: {"description":"Send invoice","client":"Contoso","due_at":"End of month"}`;

export async function initCopilot(): Promise<void> {
  try {
    client = new CopilotClient();
    await client.start();

    session = await client.createSession({
      systemMessage: { content: SYSTEM_MESSAGE },
      onPermissionRequest: async () => ({ kind: 'denied-interactively-by-user' as const }),
    });

    console.log('[copilot-sdk] Client started, session created');
  } catch (err) {
    console.error('[copilot-sdk] Failed to initialize:', err);
    client = null;
    session = null;
  }
}

export async function shutdownCopilot(): Promise<void> {
  try {
    if (session) {
      await session.disconnect();
      session = null;
    }
    if (client) {
      await client.stop();
      client = null;
    }
    console.log('[copilot-sdk] Shut down');
  } catch (err) {
    console.error('[copilot-sdk] Error during shutdown:', err);
  }
}

export async function parseIntentWithAI(rawText: string): Promise<ParsedIntent> {
  if (!session) {
    console.warn('[copilot-sdk] Session not ready, returning raw text');
    return { description: rawText, client: null, due_at: null };
  }

  try {
    const response = await session.sendAndWait({
      prompt: `Parse this intent:\nInput: "${rawText}"`,
    }, 30000);

    const content = response?.data?.content ?? '';
    const trimmed = content.trim();

    // Extract JSON from the response
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[copilot-sdk] Response was not JSON:', trimmed);
      return { description: rawText, client: null, due_at: null };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      description: parsed.description || rawText,
      client: parsed.client || null,
      due_at: parsed.due_at || null,
    };
  } catch (err) {
    console.error('[copilot-sdk] Parse failed:', err);
    return { description: rawText, client: null, due_at: null };
  }
}
