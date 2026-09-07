import {
  AGENT_PROVIDERS,
  type AgentAvailability,
  type AgentProvider
} from './types/agent-events'

export function providerPreferenceOrder(
  preferred: AgentProvider,
  lastSelected: AgentProvider
): AgentProvider[] {
  return [preferred, lastSelected, ...AGENT_PROVIDERS].filter(
    (provider, index, all) => all.indexOf(provider) === index
  )
}

export function firstConnectedProvider(
  order: readonly AgentProvider[],
  availability: Partial<Record<AgentProvider, AgentAvailability>>
): AgentProvider | null {
  return (
    order.find((provider) => {
      const state = availability[provider]
      return state?.installed === true && state.loggedIn
    }) ?? null
  )
}
