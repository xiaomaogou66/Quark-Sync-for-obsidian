import { describe, expect, it } from 'vitest'
import type { QuarkHttpFn } from './http'
import { QuarkClient } from './quark-client'
import { QuarkRemoteFs, type QuarkFidStore } from './quark-remote-fs'
import logger from '~/utils/logger'

/**
 * Live probe against the real Quark open platform.
 *
 * Skipped unless credentials are provided, so `pnpm test` stays offline:
 *
 *   QUARK_APP_ID=... QUARK_SIGN_KEY=... QUARK_ACCESS_TOKEN=... \
 *     QUARK_PROBE=1 pnpm vitest --run src/remote/quark/quark-live-probe.test.ts
 *
 * Set QUARK_PROBE_KEEP=1 to leave the probe folder behind for inspection.
 * It answers the questions that cannot be settled from source alone:
 *   1. does `file_type === '0'` mean "folder"?
 *   2. does `same_path_reuse` overwrite, reuse or duplicate?
 *   3. does `l_updated_at` survive (mtime preservation)?
 *   4. is a rapid upload (秒传) reported for unchanged content?
 *   5. do the `x_pan_*` cookies work for downloads?
 */

const appId = process.env.QUARK_APP_ID?.trim()
const signKey = process.env.QUARK_SIGN_KEY?.trim()
const accessToken = process.env.QUARK_ACCESS_TOKEN?.trim()

/**
 * Placeholder values (`QUARK_APP_ID=…`) are a very easy copy/paste mistake and
 * would otherwise fail deep inside the HTTP layer.
 */
const PLACEHOLDER = /^[…<>.\s]+$/
const placeholders = [
	['QUARK_APP_ID', appId],
	['QUARK_SIGN_KEY', signKey],
	['QUARK_ACCESS_TOKEN', accessToken],
].filter(([, value]) => !!value && PLACEHOLDER.test(value))
if (placeholders.length > 0) {
	throw new Error(
		`These variables still hold placeholders, replace them with real values: ${placeholders
			.map(([name]) => name)
			.join(', ')}`,
	)
}

const enabled =
	process.env.QUARK_PROBE === '1' && !!appId && !!signKey && !!accessToken
const rootFid = process.env.QUARK_PROBE_ROOT_FID ?? '0'
const keep = process.env.QUARK_PROBE_KEEP === '1'

const fetchHttp: QuarkHttpFn = async (request) => {
	const response = await fetch(request.url, {
		method: request.method ?? 'GET',
		headers: request.headers,
		body: request.body as BodyInit | undefined,
	})
	const buffer = await response.arrayBuffer()
	const headers: Record<string, string> = {}
	response.headers.forEach((value, key) => {
		headers[key.toLowerCase()] = value
	})
	return {
		status: response.status,
		headers,
		arrayBuffer: buffer,
		text: new TextDecoder().decode(buffer),
	}
}

function createMemoryFidStore(): QuarkFidStore {
	const store = new Map<string, Record<string, string>>()
	return {
		get: async (key) => store.get(key) ?? null,
		set: async (key, value) => {
			store.set(key, value)
			return value
		},
		unset: async (key) => {
			store.delete(key)
		},
	}
}

describe.skipIf(!enabled)('Quark live probe', () => {
	it('round-trips a folder and a file', async () => {
		const client = new QuarkClient({
			credentials: {
				appId: appId!,
				signKey: signKey!,
				accessToken: accessToken!,
			},
			http: fetchHttp,
		})

		const user = await client.userInfo()
		expect(user.user_id).toBeTruthy()

		logger.info('[probe] raw listing of parent fid', rootFid)
		for (const file of (await client.list(rootFid)).slice(0, 20)) {
			logger.info('[probe]  ', JSON.stringify(file))
		}

		const overwriteMode =
			process.env.QUARK_PROBE_OVERWRITE_MODE === 'delete-first'
				? 'delete-first'
				: 'reuse'

		const remote = new QuarkRemoteFs({
			client,
			http: fetchHttp,
			rootFid,
			kvKey: 'live-probe',
			fidStore: createMemoryFidStore(),
			overwriteMode,
		})
		await remote.init()

		const stamp = Date.now()
		const dirName = `__quark_probe_${stamp}`
		const dirPath = `/${dirName}`
		const filePath = `${dirPath}/hello.txt`
		const content = `quark probe ${stamp}`
		const mtime = Date.now() - 60_000

		await remote.mkdir(dirPath)
		const created = (await remote.list('/')).find(
			(entry) => entry.basename === dirName,
		)
		logger.info('[probe] created folder entry =', JSON.stringify(created))
		expect(created?.isDir).toBe(true)

		// 1) first upload: mtime preservation
		await remote.writeFile(
			filePath,
			new TextEncoder().encode(content).buffer,
			{ mtime },
		)
		const firstStat = await remote.stat(filePath)
		logger.info('[probe] stat after first upload =', JSON.stringify(firstStat))
		logger.info(
			'[probe] mtime preserved?',
			firstStat.mtime === mtime
				? 'yes'
				: `no (remote=${firstStat.mtime} local=${mtime}) — deciders must tolerate this`,
		)

		// 2) identical re-upload: rapid upload, no duplicate
		await remote.writeFile(
			filePath,
			new TextEncoder().encode(content).buffer,
			{ mtime },
		)
		const afterSecond = (await remote.list(dirPath)).filter(
			(entry) => entry.basename === 'hello.txt',
		)
		logger.info('[probe] entries after identical re-upload =', afterSecond.length)

		// 3) overwrite with different content
		const changed = `${content} v2`
		await remote.writeFile(filePath, new TextEncoder().encode(changed).buffer, {
			mtime,
		})
		const afterChange = (await remote.list(dirPath)).filter(
			(entry) => entry.basename === 'hello.txt',
		)
		logger.info('[probe] entries after overwrite =', afterChange.length)
		logger.info(
			'[probe] overwrite mode used:',
			overwriteMode,
			afterChange.length === 1
				? '→ single entry (ok)'
				: '→ DUPLICATES: switch 覆盖方式 to 先删除再上传',
		)

		const downloaded = await remote.readFile(filePath)
		expect(new TextDecoder().decode(downloaded)).toBe(changed)

		const range = await remote.readFileRange?.(filePath, 0, 5)
		logger.info(
			'[probe] range read =',
			range ? new TextDecoder().decode(range) : 'unsupported',
		)

		if (!keep) {
			await remote.flush()
			await remote.remove(dirPath)
			const leftover = (await remote.list('/')).find(
				(entry) => entry.basename === dirName,
			)
			expect(leftover).toBeUndefined()
		}
	}, 120_000)
})
