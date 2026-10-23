// What counts as a usable language-model provider; shared by the AI settings page and the "no model" notice of the tools.
export type UsableProvider = { id: string; configured: boolean; model?: string; local?: boolean; has_api_key?: boolean; base_url?: string; transport?: string }
// CLI agents are not offered in this app (the engine detects them only through VOICESTUDIO_LLM_AGENTS, which the launcher never sets).
export const HIDDEN_LLM_PROVIDERS = new Set(['codex-cli', 'pi-cli', 'opencode-cli', 'claude-code'])
// A connected provider (key or local server, address set; sdk transports have no address) that only lacks a default model:
// the engine can list its models, so the picker offers them.
export const modelOnlyProvider = (p: UsableProvider) => !p.model && !p.configured && (!!p.has_api_key || !!p.local) && (!!p.base_url || p.transport === 'sdk')
export const usableProvider = (p: UsableProvider) => !HIDDEN_LLM_PROVIDERS.has(p.id) && (p.configured || modelOnlyProvider(p))
