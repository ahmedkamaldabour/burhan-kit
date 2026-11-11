/** The one phase-to-skill table (phases/skills.md). The hooks, `burhan guide`, the advice after a command and the install read it; no other file names a skill. */
export type Phase = 'story' | 'plan' | 'build' | 'debug' | 'review' | 'done';
export interface PhaseSkill { name: string; why: string }

export const PHASES: Phase[] = ['story', 'plan', 'build', 'debug', 'review', 'done'];
export const SKILLS: Record<Phase, PhaseSkill> = {
  story: { name: 'burhan-story', why: 'before the story' },
  plan: { name: 'burhan-plan', why: 'before the plan and the build spec' },
  build: { name: 'burhan-build', why: 'before the failing test and the code' },
  debug: { name: 'burhan-debug', why: 'before you look for the cause' },
  review: { name: 'burhan-review', why: 'to review the sub-unit' },
  done: { name: 'burhan-done', why: 'before you claim the item is done or passing' },
};

export const skillName = (p: Phase): string => SKILLS[p].name;

/** How an agent opens a skill: Claude Code with the Skill tool, any agent by reading the file the install wrote. */
export const invokeText = (name: string): string => `${name} (the Skill tool, or read .burhan/skills/${name}/SKILL.md)`;

/** The names of these phases' skills as an `a|b` alternation, for a pattern. */
export const skillAlternation = (...phases: Phase[]): string => phases.map(skillName).join('|');

/** Matches a skill id as a hook sees it: `burhan-story`, or the same behind a plugin prefix (`plugin:burhan-story`). */
export const phaseSkillRe = (...phases: Phase[]): RegExp => new RegExp(`(^|:)(${skillAlternation(...phases)})$`);
