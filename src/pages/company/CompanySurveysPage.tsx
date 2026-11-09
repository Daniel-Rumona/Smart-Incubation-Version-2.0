import DashboardPage from '@/components/shared/DashboardPage'
import { MySurveysCard } from '@/components/training/MySurveysCard'
import '@/styles/training.css'

/** The client company's surveys from its training provider: open ones to answer, and those answered. */
export default function CompanySurveysPage() {
    return (
        <DashboardPage className="training-page">
            <MySurveysCard basePath="/company/surveys" showEmpty />
        </DashboardPage>
    )
}
