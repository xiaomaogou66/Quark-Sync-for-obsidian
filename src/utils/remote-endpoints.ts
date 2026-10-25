import { QUARK_API_BASE } from '~/remote/quark/constants'
import type { NutstoreSettings } from '~/settings'
import { getNutstoreDavEndpoint } from './nutstore-endpoints'

/**
 * Stable identifier of the active remote backend endpoint.
 *
 * Used as part of the traversal / sync-record DB key so that two backends (or
 * two Quark accounts) never share cached state.
 */
export function getRemoteBackendEndpoint(settings: NutstoreSettings) {
	return settings.remoteProvider === 'quark'
		? QUARK_API_BASE
		: getNutstoreDavEndpoint(settings)
}
