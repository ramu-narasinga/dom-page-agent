import type { AgentStepResult, DomCheckResult, TrustReport } from './types';

export async function verifyDom(expectedText: string, selector: string): Promise<DomCheckResult> {
  await new Promise(r => setTimeout(r, 300)); // let any re-render settle
  const el = document.querySelector(selector);
  const actual = (el as HTMLInputElement)?.value ?? el?.textContent ?? '';
  return { verified: actual.includes(expectedText) };
}

export function buildTrustReport(agentClaim: AgentStepResult, independentVerification: DomCheckResult): TrustReport {
  return {
    agentClaim,
    independentVerification,
    verdict: agentClaim.success && independentVerification.verified ? 'VERIFIED' : 'NEEDS_REVIEW',
  };
}
