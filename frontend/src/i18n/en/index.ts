import { enAdditions } from './additions'
import { enSettingsEngine } from './settings-engine'
import { enSettingsModels } from './settings-models'
import { enSettingsAi } from './settings-ai'
import { enSettingsConnections } from './settings-connections'
import { enSettingsData } from './settings-data'
import { enSettingsApp } from './settings-app'
import { enCore } from './core'
import { enStudio } from './studio'
import { enTools } from './tools'
import { enDemo } from './demo'

/** English catalog: Polish source text -> English. Later files win on duplicate keys (the order is the old merge order). */
export const catalog: Record<string, string> = Object.assign(Object.create(null), enAdditions, enSettingsEngine, enSettingsModels, enSettingsAi, enSettingsConnections, enSettingsData, enSettingsApp, enCore, enStudio, enTools, enDemo)
