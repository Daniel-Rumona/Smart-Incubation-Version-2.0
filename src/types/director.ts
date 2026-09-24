export type DirectorRisk = 'Low' | 'Medium' | 'High'
export type DirectorStage = 'Seed' | 'Startup' | 'Early Growth' | 'Growth' | 'Mature'

export type DirectorPortfolioSme = {
  id: string
  name: string
  sector: string
  stage: DirectorStage
  status: 'Active' | 'Warning' | 'Paused'
  risk: DirectorRisk
  valuation: number
  investment: number
  progress: number
  lastUpdate: string
  programId?: string
  programName?: string
  photoUrl?: string
  execution: {
    required: number
    completed: number
    overdue: number
    unresponsive: number
    upcoming: number
  }
  trend: Array<{ key: string; month: string; revenue: number; employees: number }>
  metrics: {
    revenue: number
    customers: number
    employees: number
    growthRate: number
  }
}

export type SectorRollup = {
  sector: string
  companies: number
  avgProgress: number
  avgGrowth: number
  totalRevenue: number
  totalValuation: number
  highRisk: number
  mediumRisk: number
  lowRisk: number
  smes: DirectorPortfolioSme[]
}

export type DirectorProgramPerformance = {
  id: string
  name: string
  status: string
  startDate?: string
  endDate?: string
  submitted: number
  accepted: number
  smes: number
  assignments: number
  completedAssignments: number
  overdueAssignments: number
  avgProgress: number
  totalRevenue: number
  totalEmployees: number
  highRisk: number
  mediumRisk: number
  lowRisk: number
}

export type DirectorOrgUnitType = 'department' | 'office'
export type DirectorOrgUnitStatus = 'active' | 'inactive'

export type DirectorOrgUnit = {
  id: string
  type: DirectorOrgUnitType
  companyCode: string
  name: string
  code?: string
  managerName?: string
  managerEmail?: string
  status: DirectorOrgUnitStatus
  notes?: string
  createdAt?: Date
  updatedAt?: Date
}
