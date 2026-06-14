import * as fs from 'fs';
import * as path from 'path';
import { getConfigValue } from './config';
import { assignSpaceFolder, createSpace, getSkill, updateCanvasContent } from './database';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { createSpaceFolder, scheduleAutoCommit } from './workspace';
import type {
  SkillFrontmatter,
  SkillInvocationFrontmatter,
  SkillInvocationInput,
  SkillInvocationResult,
} from '../shared/types';

function normalizeIntent(intent?: string): string {
  return (intent || '').trim();
}

function buildInvocationInstructions(skillName: string, intent: string): string {
  if (intent) {
    return `Run the ${skillName} skill for this request:\n\n${intent}`;
  }
  return `Run the ${skillName} skill using its default instructions.`;
}

function buildCanvasBody(title: string): string {
  return `# ${title}\n`;
}

export async function invokeSkill(input: SkillInvocationInput): Promise<SkillInvocationResult | { error: string }> {
  const workspace = getConfigValue('workspace');
  if (!workspace) return { error: 'no_workspace' };

  const skill = getSkill(input.skillId);
  if (!skill) return { error: 'not_found' };

  const intent = normalizeIntent(input.intent);
  const createdAt = new Date().toISOString();
  let skillPreferredAgent: string | undefined;
  try {
    const skillContent = fs.readFileSync(skill.filePath, 'utf-8');
    const { frontmatter } = parseFrontmatter<SkillFrontmatter>(skillContent);
    if (typeof frontmatter.preferred_agent === 'string' && frontmatter.preferred_agent.trim()) {
      skillPreferredAgent = frontmatter.preferred_agent.trim();
    }
  } catch {
    // Skill metadata is already indexed; missing optional preferred_agent should not block invocation.
  }

  const preferredAgent = input.preferredAgent?.trim() || skillPreferredAgent;
  const instructions = buildInvocationInstructions(skill.name, intent);
  const source = input.source ?? 'api';
  const titleSeed = intent ? `${skill.name}: ${intent}` : skill.name;
  const space = createSpace({ body: titleSeed }, skill.id);
  const folder = createSpaceFolder(workspace, space.id, skill.name);
  assignSpaceFolder(space.id, folder);
  space.folder = folder;

  const frontmatter: SkillInvocationFrontmatter = {
    skills: [skill.id],
    instructions,
    ...(preferredAgent ? { preferred_agent: preferredAgent } : {}),
    skill_invocation: {
      skill_id: skill.id,
      source,
      ...(intent ? { source_prompt: intent } : {}),
      created_at: createdAt,
    },
  };

  const canvasContent = serializeFrontmatter(frontmatter, buildCanvasBody(titleSeed));
  const canvasPath = path.join(workspace, folder, 'canvas.md');
  fs.writeFileSync(canvasPath, canvasContent, 'utf-8');
  updateCanvasContent(space.id, canvasContent);
  scheduleAutoCommit(workspace);

  if (!input.run) {
    return { space, canvasContent };
  }

  const { launchDocumentAgent } = await import('./agent-service');
  const agentResult = await launchDocumentAgent(space.id, workspace, folder, {
    ...(preferredAgent ? { personaHandle: preferredAgent } : {}),
    promptOverride: instructions,
  });
  if ('error' in agentResult) {
    return { space, canvasContent, error: agentResult.error };
  }

  return { space, canvasContent, agent: agentResult };
}
