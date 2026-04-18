import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ParsedIntent {
  description: string;
  client: string | null;
  due_at: string | null;
}

const PARSE_PROMPT = `You are an intent parser. Given a natural language intent, extract structured fields.
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
Output: {"description":"Send invoice","client":"Contoso","due_at":"End of month"}

Now parse this intent:`;

export async function parseIntentWithAI(rawText: string): Promise<ParsedIntent> {
  const fullPrompt = `${PARSE_PROMPT}\nInput: "${rawText}"`;

  try {
    // Use shell exec so PATH and .cmd wrappers resolve on Windows
    const escaped = fullPrompt.replace(/"/g, '\\"');
    const { stdout } = await execAsync(
      `copilot -p "${escaped}" -s --output-format text`,
      {
        timeout: 30000,
        windowsHide: true,
      }
    );

    const trimmed = stdout.trim();

    // Try to extract JSON from the response
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('AI response was not JSON:', trimmed);
      return { description: rawText, client: null, due_at: null };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      description: parsed.description || rawText,
      client: parsed.client || null,
      due_at: parsed.due_at || null,
    };
  } catch (err) {
    console.error('Copilot AI parse failed:', err);
    return { description: rawText, client: null, due_at: null };
  }
}
