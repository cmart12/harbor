import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Skill } from '../../shared/types';

import { skillStore } from './skill-store';

function makeSkill(overrides: Partial<Skill> & { id: string }): Skill {
  return {
    name: 'Test Skill',
    description: 'A test skill',
    emoji: '🧩',
    folder: '.agents/skills/test',
    filePath: '/ws/.agents/skills/test/SKILL.md',
    schedule: null,
    schedule_time: null,
    schedule_day: null,
    next_run_at: null,
    last_run_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('SkillStore', () => {
  beforeEach(() => {
    skillStore.setSkills([]);
    skillStore.setSelectedSkill(null);
  });

  it('has correct initial state after reset', () => {
    const state = skillStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.selectedSkillId).toBeNull();
  });

  it('setSkills() updates skills and notifies listeners', () => {
    const listener = vi.fn();
    const unsub = skillStore.subscribe(listener);

    const skills = [makeSkill({ id: 's1' }), makeSkill({ id: 's2' })];
    skillStore.setSkills(skills);

    expect(skillStore.getState().skills).toEqual(skills);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('setSelectedSkill() updates the selected skill', () => {
    skillStore.setSelectedSkill('s1');
    expect(skillStore.getState().selectedSkillId).toBe('s1');

    skillStore.setSelectedSkill(null);
    expect(skillStore.getState().selectedSkillId).toBeNull();
  });

  it('getSkill() returns the skill by id', () => {
    const skill = makeSkill({ id: 'find-me', name: 'Found' });
    skillStore.setSkills([makeSkill({ id: 'other' }), skill]);
    expect(skillStore.getSkill('find-me')).toEqual(skill);
  });

  it('getSkill() returns undefined for unknown id', () => {
    skillStore.setSkills([makeSkill({ id: 'x' })]);
    expect(skillStore.getSkill('nope')).toBeUndefined();
  });

  it('subscribe returns a working unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = skillStore.subscribe(listener);

    skillStore.setSelectedSkill('a');
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    skillStore.setSelectedSkill('b');
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });

  it('multiple listeners are all notified', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    const u1 = skillStore.subscribe(l1);
    const u2 = skillStore.subscribe(l2);

    skillStore.setSelectedSkill('x');

    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
    u1();
    u2();
  });
});
