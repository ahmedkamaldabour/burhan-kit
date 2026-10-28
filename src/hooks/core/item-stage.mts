/** Where an item is, what the workflow allows now, and the next step: one answer for `burhan guide` and for the hooks (AC-06, D-4).
 *  Pure — the caller reads the files. Code edits are authorized when the route's gates allow them: a patch always, a read-only route never,
 *  anything else only while its plan is Approved or In progress. */
import { hasContractMarker, storyIsApproved } from './item-contract.mjs';
import { openDeviations, overallStatus, qcAccepted, qcVerdict, planRoute, routeAllowed, routeNeeds, units } from './item-model.mjs';

/** `spec`: the build spec's text, null when the file is missing, left out when the caller does not read it. */
export interface StageInput { slug?: string; route: string; story: string | null; plan: string | null; findings: string | null; qc: string | null; spec?: string | null }
export interface Stage { stage: string; authorized: boolean; why: string; next: string }

const field = (text: string, label: string): string => new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*([^\\r\\n]*)`).exec(text)?.[1]?.replace(/\*/g, '').trim() ?? '';

export function stageOf(i: StageInput): Stage {
  const slug = i.slug ?? '<slug>';
  const [type = '', scope = ''] = i.route.split(' / ');
  const no = (stage: string, why: string, next: string): Stage => ({ stage, authorized: false, why, next });

  if (/^(feature|bug|investigation|change|refactor|release) \/ (spike|bounded|architectural|patch)$/.test(i.route) && !routeAllowed(i.route)) {
    return no('route not allowed', `${i.route} is not allowed by the routing matrix (WORKFLOW §3)`, 'route it as an investigation, or as the type and scope the matrix allows');
  }
  if (scope === 'patch') return { stage: 'patch lane', authorized: true, why: 'the patch lane has no story or plan: a routing line, the change, the evidence after it', next: 'make the one change, show the evidence, then the commit checkpoint' };

  if (type === 'investigation' || (type === 'bug' && scope === 'spike')) {
    const why = 'read-only route: no application code may be modified';
    if (i.findings === null) return no('no findings file', why, `burhan item new ${slug} --type ${type} --scope ${scope}`);
    return field(i.findings, 'Status').startsWith('Concluded')
      ? no('findings concluded', why, 'knowledge review and close-out in the state file; if code should change, propose a new routed item')
      : no('investigating', why, 'record the evidence, findings, limitations and conclusion in the findings file, then set it Concluded');
  }

  const needs = routeNeeds(i.route);
  if (i.plan === null && i.story === null) return no('no item files', 'there is no approved story or plan yet', `burhan item new ${slug} --type ${type || '<type>'} --scope ${scope || '<scope>'}`);
  if (needs.story) {
    if (i.story === null) return no('no story', 'the route needs an approved story first', `burhan item new ${slug} --type ${type} --scope ${scope}`);
    if (!storyIsApproved(i.story)) return no('story draft', 'the story is not approved', `fill the story, put every material question to the owner in one round, then burhan approve story ${slug} --by <owner name> once they approve`);
  }
  if (i.plan === null) return no(needs.story ? 'story approved, no plan' : 'no plan', 'there is no plan yet', `write ${slug}-implementation-plan.md from .burhan/templates/plan.md (keep its "Contract: 1" line), then ask the owner to approve it`);

  const status = overallStatus(i.plan);
  if (status === null || !['Draft', 'Approved', 'In progress', 'Completed', 'Paused', 'Superseded'].includes(status)) return no('plan status not recognised', `the plan's **Overall status:** is ${status === null ? 'missing' : JSON.stringify(status)}, which is not one of the known statuses`, `burhan item check ${slug}`);
  if (status === 'Draft') {
    const spec = i.spec === null ? `make the build spec (${slug}-build-spec.md, from .burhan/templates/build-spec.md: the code per sub-unit), fill the plan, then ` : 'fill the plan and the build spec (the code per sub-unit), then ';
    return no('plan draft', 'the plan is not approved', `${spec}burhan approve plan ${slug} --by <owner name> once the owner approves both`);
  }
  if (status === 'Paused' || status === 'Superseded') return no(`plan ${status}`, `the plan is ${status}`, 'ask the owner whether to resume or open a new item');

  if (status === 'Completed') {
    const why = 'the plan is Completed';
    if (!needs.qc) return no('plan completed', why, 'knowledge review (if the route has one) and close-out in the state file');
    if (i.qc === null) return no('awaiting QC', why, `run the QC in a fresh context, then burhan review add ${slug} --kind qc --by "<agent · model · context>" --verdict "PASS" or "FAIL — N issues"`);
    if (qcVerdict(i.qc) === 'FAIL') return no('QC failed', why, `the QC failed: reopen the plan (burhan item set ${slug} plan in-progress), set the failed sub-units back (burhan item set ${slug} unit N in-progress), fix them, and run the QC again with --round N`);
    if (!qcAccepted(i.qc)) return no('QC passed, not accepted', why, `ask the owner to accept the QC: burhan approve qc ${slug} --by <owner name>`);
    return no('QC accepted', why, 'knowledge review (if the route has one) and close-out in the state file');
  }

  if (i.spec === null && hasContractMarker(i.plan)) return no('build spec missing', 'the plan was made with the contract and its build spec is missing', `burhan item check ${slug}; make ${slug}-build-spec.md from .burhan/templates/build-spec.md`);
  const stops = openDeviations(i.plan);
  if (stops.length > 0) return no('deviation open', `a step deviated from the plan and the owner has not decided: Deviations row ${stops.map((d) => d.n).join(', ')}`, `STOP: ask the owner about the deviation (${stops[0]!.what}); an approved deviation updates the plan and the build spec first, then the code; burhan deviation resolve ${slug} ${stops[0]!.n} --approved|--rejected --by <owner name> once they decide`);
  const all = units(i.plan);
  const open = all.find((u) => u.rung !== 4);
  const yes = (stage: string, next: string): Stage => ({ stage, authorized: true, why: `the plan is ${status}`, next });
  if (all.length === 0 || open === undefined) return yes(all.length === 0 ? 'plan without sub-units' : 'all sub-units reviewed', all.length === 0 ? `burhan item check ${slug}` : `tick the remaining gates (burhan gate tick ${slug} <gate>), then burhan item finish ${slug}`);
  if (open.rung === -1) return yes(`Sub-unit ${open.n} has no status`, `burhan item check ${slug}`);
  if (open.rung <= 1) return yes(`Sub-unit ${open.n} to start`, `Sub-unit ${open.n}: burhan item set ${slug} unit ${open.n} in-progress, then write the failing test first`);
  if (open.rung === 2) return yes(`Sub-unit ${open.n} in progress`, `Sub-unit ${open.n}: test first, make it pass, run only its test files and then the fast check (the full suite at QC, before a commit, or when a fix lands outside the covered tests), then burhan item set ${slug} unit ${open.n} implemented`);
  return yes(`Sub-unit ${open.n} implemented`, `Sub-unit ${open.n}: get it reviewed (burhan review add ${slug} --kind review --unit ${open.n} --by "<agent · model · context>"), then burhan item set ${slug} unit ${open.n} reviewed`);
}

/** The route an item's files state, in the order story, plan, findings. */
export const routeOf = (story: string | null, plan: string | null, findings: string | null): string => planRoute(story ?? '') || planRoute(plan ?? '') || planRoute(findings ?? '');
