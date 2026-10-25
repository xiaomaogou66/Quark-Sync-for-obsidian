import type { QuarkHttpFn } from './http'

export interface QuarkRefreshedTokens {
	accessToken: string
	refreshToken: string
}

/**
 * Refresh a Quark open-platform `access_token`.
 *
 * The official token endpoint requires the app secret, which a client-side
 * plugin cannot own on the user's behalf, so two modes are supported:
 *
 * 1. `refreshEndpoint` set → OpenList-compatible relay, which is what the
 *    community currently relies on (`api.oplist.org/quarkyun/renewapi`).
 * 2. no relay → the user re-authorises manually (handled by the caller).
 */
export async function refreshQuarkTokensViaRelay(options: {
	http: QuarkHttpFn
	refreshEndpoint: string
	refreshToken: string
}): Promise<QuarkRefreshedTokens> {
	const url = new URL(options.refreshEndpoint)
	url.searchParams.set('refresh_ui', options.refreshToken)
	url.searchParams.set('server_use', 'true')
	url.searchParams.set('driver_txt', 'quarkyun_oa')

	const response = await options.http({ url: url.toString(), method: 'GET' })
	if (response.status >= 400) {
		throw new Error(
			`[quark] token relay failed (HTTP ${response.status}): ${response.text.slice(0, 200)}`,
		)
	}

	const payload = JSON.parse(response.text) as {
		access_token?: string
		refresh_token?: string
		text?: string
	}

	if (!payload.access_token || !payload.refresh_token) {
		throw new Error(
			`[quark] token relay returned no tokens: ${payload.text ?? 'unknown error'}`,
		)
	}

	return {
		accessToken: payload.access_token,
		refreshToken: payload.refresh_token,
	}
}
