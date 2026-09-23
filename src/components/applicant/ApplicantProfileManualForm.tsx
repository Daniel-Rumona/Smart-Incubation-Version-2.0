import { useEffect, useMemo } from 'react'
import { Col, DatePicker, Form, Grid, Input, InputNumber, Row, Select, Typography } from 'antd'
import { ManOutlined, WomanOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { ApplicantProfileFormValues } from '@/pages/applicant/ApplicantProfilePage'

const { Title, Text } = Typography
const { useBreakpoint } = Grid

const genderOptions = [
  { value: 'Male', label: 'Male', Icon: ManOutlined },
  { value: 'Female', label: 'Female', Icon: WomanOutlined },
]

function GenderChoiceGroup({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  return (
    <div className="applicant-profile-choice-grid" role="radiogroup" aria-label="Gender">
      {genderOptions.map(({ value: optionValue, label, Icon }) => (
        <button
          key={optionValue}
          type="button"
          role="radio"
          aria-checked={value === optionValue}
          className={`applicant-profile-choice-card${value === optionValue ? ' is-selected' : ''}`}
          onClick={() => onChange?.(optionValue)}
        >
          <Icon />
          <strong>{label}</strong>
        </button>
      ))}
    </div>
  )
}

const sectors = [
  'Agriculture',
  'Construction',
  'Education',
  'Finance',
  'Health',
  'Information Technology',
  'Manufacturing',
  'Retail',
  'Tourism and Hospitality',
  'Transport and Logistics',
  'Other',
]

const provinces = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
]

const selectFilter = (input: string, option?: { label?: string; value?: string }) =>
  String(option?.label ?? option?.value ?? '').toLowerCase().includes(input.toLowerCase())

function isValidSouthAfricanID(value?: string) {
  if (!value) return true
  return /^\d{13}$/.test(value)
}

function isValidZARegistration(value?: string) {
  if (!value) return true
  return /^\d{4}\/\d{6}\/\d{2}$/.test(value) || /^[A-Za-z0-9\-/ ]{4,30}$/.test(value)
}

type ApplicantProfileManualFormProps = {
  activeStep: number
  email?: string
}

export default function ApplicantProfileManualForm({ activeStep, email }: ApplicantProfileManualFormProps) {
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const form = Form.useFormInstance<ApplicantProfileFormValues>()
  const registrationStatus = Form.useWatch('registrationStatus', form)
  const registrationFieldsDisabled = registrationStatus === 'not_registered'

  const currentYear = useMemo(() => dayjs().year(), [])

  useEffect(() => {
    if (email) form.setFieldValue('email', email)
  }, [email, form])

  useEffect(() => {
    if (registrationStatus === 'not_registered') {
      form.setFieldsValue({
        registrationNumber: undefined,
        dateOfRegistration: undefined,
      })
    }
  }, [form, registrationStatus])

  if (activeStep === 0) {
    return (
      <section className="applicant-profile-step-panel">
        <Title level={isMobile ? 5 : 4}>Personal details</Title>
        <Text type="secondary">Capture the applicant identity and demographic details.</Text>

        <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
          <Col xs={24} md={8}>
            <Form.Item name="participantName" label="Full name" rules={[{ required: true }]}>
              <Input placeholder="Applicant full name" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="email" label="Email" rules={[{ required: true }, { type: 'email' }]}>
              <Input inputMode="email" placeholder="name@example.com" disabled />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="gender" label="Gender" rules={[{ required: true }]}>
              <GenderChoiceGroup />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="idNumber"
              label="ID number"
              rules={[
                {
                  validator: (_, value) =>
                    isValidSouthAfricanID(value)
                      ? Promise.resolve()
                      : Promise.reject(new Error('Enter a valid 13 digit South African ID number')),
                },
              ]}
              getValueFromEvent={(event) => event.target.value.replace(/\D/g, '').slice(0, 13)}
            >
              <Input inputMode="numeric" maxLength={13} placeholder="e.g. 9001015009087" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="maritalStatus" label="Marital status">
              <Select
                allowClear
                placeholder="Select marital status"
                options={[
                  { value: 'single', label: 'Single' },
                  { value: 'married', label: 'Married' },
                  { value: 'divorced', label: 'Divorced' },
                  { value: 'widowed', label: 'Widowed' },
                  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="educationLevel" label="Education level">
              <Select
                allowClear
                placeholder="Select education level"
                options={[
                  { value: 'primary', label: 'Primary' },
                  { value: 'secondary', label: 'Secondary' },
                  { value: 'certificate', label: 'Certificate' },
                  { value: 'diploma', label: 'Diploma' },
                  { value: 'degree', label: 'Degree' },
                  { value: 'postgraduate', label: 'Postgraduate' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
      </section>
    )
  }

  if (activeStep === 1) {
    return (
      <section className="applicant-profile-step-panel">
        <Title level={isMobile ? 5 : 4}>Contact and employment</Title>
        <Text type="secondary">Capture contact details and the applicant's current employment context.</Text>

        <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
          <Col xs={24} md={8}>
            <Form.Item name="phone" label="Phone number" rules={[{ required: true }]}>
              <Input inputMode="tel" placeholder="e.g. 082 123 4567" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="alternativePhone" label="Alternative phone">
              <Input inputMode="tel" placeholder="Optional" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="employmentStatus" label="Employment status">
              <Select
                allowClear
                placeholder="Select employment status"
                options={[
                  { value: 'employed', label: 'Employed' },
                  { value: 'self_employed', label: 'Self-employed' },
                  { value: 'unemployed', label: 'Unemployed' },
                  { value: 'student', label: 'Student' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="disabilityStatus" label="Disability status">
              <Select
                allowClear
                placeholder="Select option"
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
      </section>
    )
  }

  if (activeStep === 2) {
    return (
      <section className="applicant-profile-step-panel">
        <Title level={isMobile ? 5 : 4}>Business details</Title>
        <Text type="secondary">Capture the enterprise profile and what the business does.</Text>

        <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
          <Col xs={24} md={12}>
            <Form.Item name="businessName" label="Business name" rules={[{ required: true }]}>
              <Input placeholder="Company or trading name" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="sector" label="Sector" rules={[{ required: true }]}>
              <Select
                showSearch
                allowClear
                placeholder="Select sector"
                filterOption={selectFilter}
                options={sectors.map((sector) => ({ value: sector, label: sector }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              name="natureOfBusiness"
              label="Nature of business"
              rules={[{ required: true, message: 'Explain what the business offers' }]}
            >
              <Input.TextArea autoSize={{ minRows: 4 }} placeholder="Describe products, services, customers, and operations" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="yearsOfTrading" label="Years of trading" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
      </section>
    )
  }

  if (activeStep === 3) {
    return (
      <section className="applicant-profile-step-panel">
        <Title level={isMobile ? 5 : 4}>Compliance and ownership</Title>
        <Text type="secondary">Capture registration status, B-BBEE context, and ownership profile.</Text>

        <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
          <Col xs={24} md={8}>
            <Form.Item name="registrationStatus" label="Registration status">
              <Select
                allowClear
                placeholder="Select status"
                options={[
                  { value: 'registered', label: 'Registered' },
                  { value: 'not_registered', label: 'Not registered' },
                  { value: 'in_progress', label: 'In progress' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="registrationNumber"
              label="Registration number"
              rules={[
                { required: registrationStatus === 'registered', message: 'Registration number is required when registered' },
                {
                  validator: (_, value) =>
                    isValidZARegistration(value)
                      ? Promise.resolve()
                      : Promise.reject(new Error('Enter a valid registration number')),
                },
              ]}
            >
              <Input placeholder="e.g. 2024/123456/07" disabled={registrationFieldsDisabled} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="dateOfRegistration" label="Date of registration">
              <DatePicker
                style={{ width: '100%' }}
                disabled={registrationFieldsDisabled}
                disabledDate={(date) => !!date && date.year() > currentYear}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="beeLevel" label="B-BBEE level">
              <Select
                allowClear
                placeholder="Select level"
                options={['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8', 'Not sure'].map((value) => ({ value, label: value }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="youthOwnedPercent" label="Youth-owned %">
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="femaleOwnedPercent" label="Female-owned %">
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="blackOwnedPercent" label="Black-owned %">
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
      </section>
    )
  }

  return (
    <section className="applicant-profile-step-panel">
      <Title level={isMobile ? 5 : 4}>Operating location</Title>
      <Text type="secondary">Capture where the business operates and how it is situated.</Text>

      <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Form.Item name="province" label="Province" rules={[{ required: true }]}>
            <Select
              showSearch
              allowClear
              placeholder="Select province"
              filterOption={selectFilter}
              options={provinces.map((province) => ({ value: province, label: province }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="city" label="City / town" rules={[{ required: true }]}>
            <Input placeholder="City or town" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="postalCode" label="Postal code">
            <Input inputMode="numeric" placeholder="Optional" />
          </Form.Item>
        </Col>
        <Col xs={24}>
          <Form.Item name="businessAddress" label="Business address" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 3 }} placeholder="Physical operating address" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="hostCommunity" label="Host community">
            <Input placeholder="Community, township, industrial area, or ward" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="locationType" label="Location type">
            <Select
              allowClear
              placeholder="Select location type"
              options={[
                { value: 'urban', label: 'Urban' },
                { value: 'peri_urban', label: 'Peri-urban' },
                { value: 'rural', label: 'Rural' },
                { value: 'industrial', label: 'Industrial' },
                { value: 'home_based', label: 'Home-based' },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>
    </section>
  )
}
