import { joinProgramAsSme } from '@/services/programLinkService'
import type { SmeOnboardingAnswers } from '@/types/smeOnboarding'

/**
 * The server sets the SME's company, after checking the programme and that the company lets SMEs apply for
 * themselves. The browser can no longer write its own company code.
 */
export const completeSmeOnboarding = async (answers: SmeOnboardingAnswers) => {
  await joinProgramAsSme({
    path: answers.path === 'company_program' || answers.path === 'open_program' || answers.path === 'marketplace' ? answers.path : 'marketplace',
    programId: answers.selectedProgramId,
    companyCode: answers.hasCompany ? answers.companyCode : undefined,
    consultingBudget: answers.consultingBudget,
    wantsSpecificProgram: answers.wantsSpecificProgram,
  })
}

/**
 * Skipping still has to leave the SME somewhere. Anyone who did not arrive through a company's
 * program link lands in the platform owner's bucket, which is what gives them the marketplace.
 */
export const skipSmeOnboarding = async () => {
  await joinProgramAsSme({ path: 'skip' })
}
