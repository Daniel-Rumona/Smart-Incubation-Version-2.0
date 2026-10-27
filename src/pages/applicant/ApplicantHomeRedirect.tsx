import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { getApplicantProfileBundle, isApplicantProfileComplete } from '@/services/applicantService'

/**
 * Where an applicant lands after signing in. SMEs who chose consultants and agents go to their dashboard (it
 * prompts for the profile itself). Programme applicants go to Programmes once their profile is complete, otherwise
 * to the guided profile setup. The profile is always one click away under My profile.
 */
export default function ApplicantHomeRedirect() {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const [target, setTarget] = useState<string | null>(null)
    const independent = user?.smeJourney === 'independent'

    useEffect(() => {
        if (!user || independent) return
        let active = true
        getApplicantProfileBundle(user.uid, user.email)
            .then((bundle) => { if (active) setTarget(isApplicantProfileComplete(bundle) ? '/applicant/programs' : '/applicant/profile') })
            .catch(() => { if (active) setTarget('/applicant/programs') })
        return () => { active = false }
    }, [independent, user])

    if (independent) return <Navigate to="/applicant/dashboard" replace />
    return target ? <Navigate to={target} replace /> : <PageSkeleton variant="detail" label={t('Loading your workspace')} />
}
