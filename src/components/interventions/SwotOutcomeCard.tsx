import { Card, Col, Empty, Row, Space, Tag, Tooltip, Typography } from 'antd'
import { useLanguage } from '@/providers/LanguageProvider'
import type { LivePlanItem } from '@/utils/liveDiagnosticPlan'
import { SWOT_QUADRANTS, SWOT_QUADRANT_LABEL, evaluateSwot, summariseSwot, type SwotItem, type SwotOutcome, type SwotQuadrant } from '@/utils/swotOutcomes'

const { Text } = Typography

const TONE_COLOR: Record<SwotOutcome['tone'], string> = { good: 'green', warn: 'gold', bad: 'red', neutral: 'default' }
const SUMMARY_VERB: Record<SwotQuadrant, string> = { weaknesses: 'resolved', threats: 'mitigated', strengths: 'strengthened', opportunities: 'captured' }

const evidenceText = (outcome: SwotOutcome) => outcome.evidence.length
  ? outcome.evidence.map(row => `${row.title}: ${row.status}${row.result ? ` · ${row.result.replace('_', ' ')}` : ''}${row.note ? ` (${row.note})` : ''}`).join('\n')
  : 'No intervention in this area of support.'

/**
 * The SME's SWOT, each item matched to the interventions in the same area of support, showing whether the work
 * has resolved the weakness, mitigated the threat, strengthened the strength or captured the opportunity.
 */
export default function SwotOutcomeCard({ items, planItems }: { items: SwotItem[]; planItems: LivePlanItem[] }) {
  const { t } = useLanguage()
  if (!items.length) return null
  const outcomes = evaluateSwot(items, planItems)
  const summary = summariseSwot(outcomes)

  return (
    <Card size="small" title={t('SWOT and outcomes')} className="diagnostic-plan-section">
      <Space size={[16, 4]} wrap style={{ marginBottom: 12 }}>
        {SWOT_QUADRANTS.filter(quadrant => summary[quadrant].total).map(quadrant => (
          <Text key={quadrant} type="secondary">
            <Text strong>{summary[quadrant].achieved}/{summary[quadrant].total}</Text> {t(SWOT_QUADRANT_LABEL[quadrant]).toLowerCase()} {t(SUMMARY_VERB[quadrant])}
          </Text>
        ))}
      </Space>
      <Row gutter={[12, 12]}>
        {SWOT_QUADRANTS.map(quadrant => {
          const rows = outcomes.filter(outcome => outcome.item.quadrant === quadrant)
          return (
            <Col key={quadrant} xs={24} md={12}>
              <Text strong>{t(SWOT_QUADRANT_LABEL[quadrant])}</Text>
              {rows.length ? (
                <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 6 }}>
                  {rows.map(outcome => (
                    <div key={outcome.item.text}>
                      <div>{outcome.item.text}</div>
                      <Space size={4} wrap>
                        <Tag>{outcome.item.areaOfSupport}</Tag>
                        <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{evidenceText(outcome)}</span>}>
                          <Tag color={TONE_COLOR[outcome.tone]}>{t(outcome.label)}</Tag>
                        </Tooltip>
                      </Space>
                    </div>
                  ))}
                </Space>
              ) : <div><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ margin: 0 }} /></div>}
            </Col>
          )
        })}
      </Row>
    </Card>
  )
}
