export const WORKFLOW_PACK_SCHEMA_VERSION = 1
export const CUSTOM_PACK_PREFIX = 'custom:'

export type WorkflowPackScope =
  | 'course'
  | 'material'
  | 'selection'
  | 'browser-tab'

export interface WorkflowPackOutputs {
  dir: string
  primary: string
}

export interface WorkflowPackFollowUp {
  label: string
  recipe: string
}

export interface WorkflowPack {
  schemaVersion: 1
  id: string
  name: string
  description: string
  author: string
  version: string
  locale: 'ko-KR' | 'en-US'
  worksOn: readonly WorkflowPackScope[]
  recipe: string
  allowedTools: readonly string[]
  usesWeb: boolean
  outputs: WorkflowPackOutputs
  followUp?: WorkflowPackFollowUp
}

export interface WorkflowPackSummary {
  pack: WorkflowPack
  source: 'builtin' | 'user'
  enabled: boolean
  approvedAt: string | null
}
