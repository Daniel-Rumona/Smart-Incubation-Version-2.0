import { useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getApplicantProfileBundle, isApplicantProfileComplete } from '@/services/applicantService'
import { forgetProgramLink, joinProgramAsSme } from '@/services/programLinkService'

/** Joins a programme from its link and sends the SME to its application (profile first, if it is not finished yet). */
export const useJoinProgramByLink = () => {
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    return async (programId: string) => {
        if (!user) return
        const joined = await joinProgramAsSme({ path: 'program_link', programId })
        await forgetProgramLink(user.uid)
        const bundle = await getApplicantProfileBundle(user.uid, user.email)
        navigate(isApplicantProfileComplete(bundle) ? `/applicant/programs/${joined.programId}/apply` : '/applicant/profile')
    }
}
