import { Card, Descriptions, Empty, Space, Tag, Typography } from 'antd'
import type { ApplicationFormValues, ProgramDocumentRequirement, ProgramIntervention } from '@/types/application'
import { getExpiredOrExpiringDocuments, getMissingDocuments } from '@/services/applicationService'
import { useLanguage } from '@/providers/LanguageProvider'

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
  const { t } = useLanguage()
  const missingDocuments = getMissingDocuments(documents)
  const expiringDocuments = getExpiredOrExpiringDocuments(documents)

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Card title={t('Business details')} className="program-application-soft-card">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={t('Business name')}>{valueOrDash(values.beneficiaryName)}</Descriptions.Item>
          <Descriptions.Item label={t('Owner name')}>{valueOrDash(values.participantName)}</Descriptions.Item>
          <Descriptions.Item label={t('Email')}>{valueOrDash(values.email)}</Descriptions.Item>
          <Descriptions.Item label={t('Phone')}>{valueOrDash(values.phone)}</Descriptions.Item>
          <Descriptions.Item label={t('ID number')}>{valueOrDash(values.idNumber)}</Descriptions.Item>
          <Descriptions.Item label={t('Gender')}>{valueOrDash(values.gender)}</Descriptions.Item>
          <Descriptions.Item label={t('Sector')}>{valueOrDash(values.sector)}</Descriptions.Item>
          <Descriptions.Item label={t('Years trading')}>{valueOrDash(values.yearsOfTrading)}</Descriptions.Item>
          <Descriptions.Item label={t('Registration number')}>{valueOrDash(values.registrationNumber)}</Descriptions.Item>
          <Descriptions.Item label={t('Date registered')}>{valueOrDash(values.dateOfRegistration)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={t('Location and motivation')} className="program-application-soft-card">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={t('Business address')}>{valueOrDash(values.businessAddress)}</Descriptions.Item>
          <Descriptions.Item label={t('City')}>{valueOrDash(values.city)}</Descriptions.Item>
          <Descriptions.Item label={t('Province')}>{valueOrDash(values.province)}</Descriptions.Item>
          <Descriptions.Item label={t('Host community')}>{valueOrDash(values.hub)}</Descriptions.Item>
          <Descriptions.Item label={t('Location type')}>{valueOrDash(values.location)}</Descriptions.Item>
          <Descriptions.Item label={t('Postal code')}>{valueOrDash(values.postalCode)}</Descriptions.Item>
          <Descriptions.Item label={t('Nature of business')} span={2}>{valueOrDash(values.natureOfBusiness)}</Descriptions.Item>
          <Descriptions.Item label={t('Motivation')} span={2}>{valueOrDash(values.motivation)}</Descriptions.Item>
          <Descriptions.Item label={t('Challenges')} span={2}>{valueOrDash(values.challenges)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={t('SWOT analysis')} className="program-application-soft-card">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={t('Strengths')}>{valueOrDash(values.swotStrengths)}</Descriptions.Item>
          <Descriptions.Item label={t('Weaknesses')}>{valueOrDash(values.swotWeaknesses)}</Descriptions.Item>
          <Descriptions.Item label={t('Opportunities')}>{valueOrDash(values.swotOpportunities)}</Descriptions.Item>
          <Descriptions.Item label={t('Threats')}>{valueOrDash(values.swotThreats)}</Descriptions.Item>
        </Descriptions>
      </Card>

      {programQuestions.length ? (
        <Card title={t('Programme questions')} className="program-application-soft-card">
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            {programQuestions.map((question) => (
              <Descriptions.Item key={question.id} label={question.label}>
                {valueOrDash(values.profile?.[question.id])}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}

      <Card title={t('Compliance')} className="program-application-soft-card">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={t('Compliance score')}>
            <Tag color={complianceScore >= 80 ? 'green' : complianceScore >= 50 ? 'orange' : 'red'}>{complianceScore}%</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('Missing documents')}>{missingDocuments.length}</Descriptions.Item>
          <Descriptions.Item label={t('Expired / near expiry')}>{expiringDocuments.length}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={t('Selected interventions')} className="program-application-soft-card">
        {selectedInterventions.length ? (
          <Space direction="vertical" size={6}>
            {selectedInterventions.map((item) => (
              <Text key={item.id}>{item.title} {item.area ? <Text type="secondary">· {item.area}</Text> : null}</Text>
            ))}
          </Space>
        ) : (
          <Empty description={t('No interventions selected.')} />
        )}
      </Card>
    </Space>
  )
}
