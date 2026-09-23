import { Card, Descriptions, Empty, Space, Tag, Typography } from 'antd'
import type { ApplicationFormValues, ProgramDocumentRequirement, ProgramIntervention } from '@/types/application'
import { getExpiredOrExpiringDocuments, getMissingDocuments } from '@/services/applicationService'

const { Text } = Typography

type Props = {
  values: ApplicationFormValues
  complianceScore: number
  documents: ProgramDocumentRequirement[]
  selectedInterventions: ProgramIntervention[]
  programQuestions?: { id: string; label: string }[]
}

function valueOrDash(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Not provided'
  return value === undefined || value === null || value === '' ? 'Not provided' : String(value)
}

export default function ApplicationReviewPanel({ values, complianceScore, documents, selectedInterventions, programQuestions = [] }: Props) {
  const missingDocuments = getMissingDocuments(documents)
  const expiringDocuments = getExpiredOrExpiringDocuments(documents)

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Card title="Business details" className="program-application-soft-card">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="Business name">{valueOrDash(values.beneficiaryName)}</Descriptions.Item>
          <Descriptions.Item label="Owner name">{valueOrDash(values.participantName)}</Descriptions.Item>
          <Descriptions.Item label="Email">{valueOrDash(values.email)}</Descriptions.Item>
          <Descriptions.Item label="Phone">{valueOrDash(values.phone)}</Descriptions.Item>
          <Descriptions.Item label="ID number">{valueOrDash(values.idNumber)}</Descriptions.Item>
          <Descriptions.Item label="Gender">{valueOrDash(values.gender)}</Descriptions.Item>
          <Descriptions.Item label="Sector">{valueOrDash(values.sector)}</Descriptions.Item>
          <Descriptions.Item label="Years trading">{valueOrDash(values.yearsOfTrading)}</Descriptions.Item>
          <Descriptions.Item label="Registration number">{valueOrDash(values.registrationNumber)}</Descriptions.Item>
          <Descriptions.Item label="Date registered">{valueOrDash(values.dateOfRegistration)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Location and motivation" className="program-application-soft-card">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="Business address">{valueOrDash(values.businessAddress)}</Descriptions.Item>
          <Descriptions.Item label="City">{valueOrDash(values.city)}</Descriptions.Item>
          <Descriptions.Item label="Province">{valueOrDash(values.province)}</Descriptions.Item>
          <Descriptions.Item label="Host community">{valueOrDash(values.hub)}</Descriptions.Item>
          <Descriptions.Item label="Location type">{valueOrDash(values.location)}</Descriptions.Item>
          <Descriptions.Item label="Postal code">{valueOrDash(values.postalCode)}</Descriptions.Item>
          <Descriptions.Item label="Nature of business" span={2}>{valueOrDash(values.natureOfBusiness)}</Descriptions.Item>
          <Descriptions.Item label="Motivation" span={2}>{valueOrDash(values.motivation)}</Descriptions.Item>
          <Descriptions.Item label="Challenges" span={2}>{valueOrDash(values.challenges)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="SWOT analysis" className="program-application-soft-card">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="Strengths">{valueOrDash(values.swotStrengths)}</Descriptions.Item>
          <Descriptions.Item label="Weaknesses">{valueOrDash(values.swotWeaknesses)}</Descriptions.Item>
          <Descriptions.Item label="Opportunities">{valueOrDash(values.swotOpportunities)}</Descriptions.Item>
          <Descriptions.Item label="Threats">{valueOrDash(values.swotThreats)}</Descriptions.Item>
        </Descriptions>
      </Card>

      {programQuestions.length ? (
        <Card title="Programme questions" className="program-application-soft-card">
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            {programQuestions.map((question) => (
              <Descriptions.Item key={question.id} label={question.label}>
                {valueOrDash(values.profile?.[question.id])}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}

      <Card title="Compliance" className="program-application-soft-card">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="Compliance score">
            <Tag color={complianceScore >= 80 ? 'green' : complianceScore >= 50 ? 'orange' : 'red'}>{complianceScore}%</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Missing documents">{missingDocuments.length}</Descriptions.Item>
          <Descriptions.Item label="Expired / near expiry">{expiringDocuments.length}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Selected interventions" className="program-application-soft-card">
        {selectedInterventions.length ? (
          <Space direction="vertical" size={6}>
            {selectedInterventions.map((item) => (
              <Text key={item.id}>{item.title} {item.area ? <Text type="secondary">· {item.area}</Text> : null}</Text>
            ))}
          </Space>
        ) : (
          <Empty description="No interventions selected." />
        )}
      </Card>
    </Space>
  )
}
