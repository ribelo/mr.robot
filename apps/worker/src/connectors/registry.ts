/**
 * The connector implementations by kind (v1.5). A connector appears here when its ticket lands;
 * the Plugins page lists it from plugins/catalog.ts either way.
 */
import type { ConnectorKind } from '@mr-robot/protocol'
import type { ConnectorPlugin } from './connector.ts'

export const CONNECTOR_PLUGINS: Partial<Record<ConnectorKind, ConnectorPlugin>> = {}
