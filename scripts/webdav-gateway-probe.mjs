#!/usr/bin/env node
/**
 * Out-of-app probe for a WebDAV gateway (Alist / OpenList / quarkdrive-webdav).
 *
 * Answers "is it the gateway/credentials or the plugin?" without launching
 * Obsidian. It uses the same `webdav` client the plugin uses.
 *
 * Usage:
 *   GATEWAY_URL=http://127.0.0.1:5244/dav \
 *   GATEWAY_USER=admin GATEWAY_PASS=secret \
 *     node scripts/webdav-gateway-probe.mjs [remote/path]
 *
 * Notes:
 * - The URL must include the WebDAV path (Alist: /dav).
 * - Alist needs its dashboard account password, not a site token.
 */

import { createClient } from 'webdav'

const url = process.env.GATEWAY_URL
const username = process.env.GATEWAY_USER ?? ''
const password = process.env.GATEWAY_PASS ?? ''
const remotePath = process.argv[2] ?? '/'

if (!url) {
	console.error('Set GATEWAY_URL, e.g. GATEWAY_URL=http://127.0.0.1:5244/dav')
	process.exit(2)
}

const normalized = url.endsWith('/') ? url : `${url}/`
const client = createClient(normalized, { username, password })

const steps = []
async function step(name, fn) {
	try {
		const result = await fn()
		steps.push({ name, ok: true, result })
		console.log(`PASS  ${name}${result === undefined ? '' : ` — ${JSON.stringify(result).slice(0, 200)}`}`)
		return result
	} catch (error) {
		steps.push({ name, ok: false, error })
		console.log(`FAIL  ${name} — ${error.message}`)
		// Stop at the first failure: later steps depend on it.
		throw error
	}
}

try {
	await step('root exists (PROPFIND /)', () => client.exists('/'))
	await step(`root listing (PROPFIND /?Depth=1)`, async () => {
		const items = await client.getDirectoryContents('/')
		return items.slice(0, 10).map((item) => `${item.type === 'directory' ? 'd' : 'f'} ${item.basename}`)
	})
	await step(`target path listing ${remotePath}`, async () => {
		const items = await client.getDirectoryContents(remotePath)
		return `${items.length} item(s)`
	})
	await step(`write+read+delete round trip in ${remotePath}`, async () => {
		const join = (name) =>
			`${remotePath.replace(/\/$/, '')}/${name}`
		const name = `__probe_${Date.now()}.txt`
		const file = join(name)
		const body = `webdav gateway probe ${new Date().toISOString()}`
		await client.putFileContents(file, body, { overwrite: true })
		const read = await client.getFileContents(file, { format: 'text' })
		await client.deleteFile(file)
		if (typeof read !== 'string' || !read.includes('webdav gateway probe')) {
			throw new Error('content mismatch after round trip')
		}
		return 'ok'
	})
	console.log('\nAll WebDAV gateway checks passed.')
} catch {
	console.log('\nProbe stopped at the first failure (see above).')
	console.log(`URL: ${normalized}`)
	console.log(`User: ${username || '(empty)'}`)
	if (url && !url.replace(/\/$/, '').endsWith('/dav')) {
		console.log('Hint: Alist/OpenList expose WebDAV at /dav — did you forget that path?')
	}
	if (!username) {
		console.log('Hint: Alist requires the dashboard account, not a token.')
	}
	console.log(
		'Hint: for HTTP 401 check the username/password pair; for 404/405 make sure',
	)
	console.log('      the URL ends with /dav and the gateway is not behind a sub-path.')
	process.exit(1)
}
