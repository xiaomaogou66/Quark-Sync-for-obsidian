import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { QuarkHttpFn, QuarkHttpRequest } from './http'
import { QuarkAuthError, QuarkClient } from './quark-client'

const CREDENTIALS = {
	appId: 'test-app-id',
	signKey: 'test-sign-key',
	accessToken: 'test-access-token',
	refreshToken: 'test-refresh-token',
	userId: 'user-123',
}

const json = (data: unknown, status = 200) => ({
	status,
	headers: {},
	text: JSON.stringify({ status: 200, errno: 0, data }),
	arrayBuffer: new ArrayBuffer(0),
})

const errorEnvelope = (errno: number, errorInfo: string) => ({
	status: 200,
	headers: {},
	text: JSON.stringify({ status: -1, errno, error_info: errorInfo, data: null }),
	arrayBuffer: new ArrayBuffer(0),
})

function createClient(handler: (request: QuarkHttpRequest) => unknown) {
	const calls: QuarkHttpRequest[] = []
	const http: QuarkHttpFn = async (request) => {
		calls.push(request)
		return (await handler(request)) as ReturnType<typeof json>
	}
	const client = new QuarkClient({
		credentials: { ...CREDENTIALS },
		http,
		now: () => 1700000000000,
		newRequestId: () => 'req-1',
	})
	return { client, calls }
}

describe('QuarkClient', () => {
	it('signs requests with sha256(method&endpoint&tm&signKey)', async () => {
		const { client, calls } = createClient(() => json({ user_id: 'user-123' }))
		await client.userInfo()

		const request = calls[0]
		const expected = createHash('sha256')
			.update('GET&/open/v1/user/info&1700000000000&test-sign-key')
			.digest('hex')

		expect(request.headers?.['x-pan-token']).toBe(expected)
		expect(request.headers?.['x-pan-tm']).toBe('1700000000000')
		expect(request.headers?.['x-pan-client-id']).toBe('test-app-id')
		expect(request.url).toContain('access_token=test-access-token')
		expect(request.url).toContain('req_id=req-1')
	})

	it('paginates listings with the query cursor', async () => {
		let page = 0
		const { client } = createClient(() => {
			page += 1
			if (page === 1) {
				return {
					status: 200,
					headers: {},
					text: JSON.stringify({
						status: 200,
						errno: 0,
						data: {
							file_list: [{ fid: 'a', filename: 'a.md', file_type: '1' }],
							last_page: false,
							next_query_cursor: { token: 'cursor-1' },
						},
					}),
					arrayBuffer: new ArrayBuffer(0),
				}
			}
			return {
				status: 200,
				headers: {},
				text: JSON.stringify({
					status: 200,
					errno: 0,
					data: {
						file_list: [{ fid: 'b', filename: 'b.md', file_type: '1' }],
						last_page: true,
					},
				}),
				arrayBuffer: new ArrayBuffer(0),
			}
		})

		const files = await client.list('0')
		expect(files.map((file) => file.fid)).toEqual(['a', 'b'])
	})

	it('treats file_type "0" as a folder', () => {
		const { client } = createClient(() => json({}))
		expect(client.isFolder({ fid: '1', filename: 'dir', file_type: '0' })).toBe(
			true,
		)
		expect(client.isFolder({ fid: '2', filename: 'a.md', file_type: '1' })).toBe(
			false,
		)
	})

	it('refreshes credentials once when the access token expired', async () => {
		const responses = [
			errorEnvelope(11001, 'token expired'),
			json({ user_id: 'user-123' }),
		]
		const http: QuarkHttpFn = async () => responses.shift()!
		const refresh = vi.fn(async () => ({
			...CREDENTIALS,
			accessToken: 'new-token',
		}))
		const client = new QuarkClient({
			credentials: { ...CREDENTIALS },
			http,
			refreshCredentials: refresh,
		})

		await client.userInfo()
		expect(refresh).toHaveBeenCalledTimes(1)
		expect(client.accessToken).toBe('new-token')
	})

	it('surfaces an auth error when no refresh is configured', async () => {
		const http: QuarkHttpFn = async () => errorEnvelope(11001, 'token expired')
		const client = new QuarkClient({ credentials: { ...CREDENTIALS }, http })

		await expect(client.userInfo()).rejects.toBeInstanceOf(QuarkAuthError)
	})

	it('builds the rapid-upload proof from the signed token', () => {
		const { client } = createClient(() => json({}))
		const data = new TextEncoder().encode('0123456789abcdefghij').buffer
		const proof = client.buildProof(data, 'signed-token')

		const md5 = (value: string) =>
			createHash('md5').update(value).digest('hex')
		const seed1 = md5(`user-123signed-token`)
		const seed2 = md5(String(data.byteLength))
		expect(proof.proof_version).toBe('v1')
		expect(proof.proof_seed1).toBe(seed1)
		expect(proof.proof_seed2).toBe(seed2)

		const index = Number(
			BigInt(`0x${md5(seed1).slice(0, 16)}`) % BigInt(data.byteLength),
		)
		const expectedCode = Buffer.from(
			new Uint8Array(data, index, Math.min(8, data.byteLength - index)),
		).toString('base64')
		expect(proof.proof_code1).toBe(expectedCode)
	})

	it('uploads in parts and finishes the task', async () => {
		const content = new Uint8Array(10).fill(7).buffer
		const requests: QuarkHttpRequest[] = []
		const http: QuarkHttpFn = async (request) => {
			requests.push(request)
			if (request.url.includes('/open/v1/file/upload_pre')) {
				return json({
					finish: false,
					task_id: 'task-1',
					part_size: 4,
					common_headers: {
						'X-Oss-Date': 'date',
						'X-Oss-Content-Sha256': 'sha',
					},
				}) as never
			}
			if (request.url.includes('/open/v1/file/get_upload_urls')) {
				return json({
					common_headers: {
						'X-Oss-Date': 'date',
						'X-Oss-Content-Sha256': 'sha',
					},
					upload_urls: [1, 2, 3].map((partNumber) => ({
						part_number: partNumber,
						upload_url: `https://oss.example.com/part-${partNumber}`,
						signature_info: { signature: `sig-${partNumber}` },
					})),
				}) as never
			}
			if (request.url.startsWith('https://oss.example.com/')) {
				return {
					status: 200,
					headers: { etag: `etag-${request.url.split('-').pop()}` },
					text: '',
					arrayBuffer: new ArrayBuffer(0),
				}
			}
			if (request.url.includes('/open/v1/file/upload_finish')) {
				return json({ finish: true, fid: 'fid-1' }) as never
			}
			throw new Error(`unexpected request: ${request.url}`)
		}

		const client = new QuarkClient({ credentials: { ...CREDENTIALS }, http })
		const result = await client.upload({
			parentFid: '0',
			name: 'note.md',
			data: content,
			mtime: 1690000000000,
			md5: 'md5-value',
			sha1: 'sha1-value',
		})

		expect(result).toEqual({ fid: 'fid-1', rapidUpload: false })

		const preBody = JSON.parse(requests[0].body as string)
		expect(preBody.l_updated_at).toBe(1690000000000)
		expect(preBody.same_path_reuse).toBe(true)
		expect(preBody.pdir_fid).toBe('0')

		const partPuts = requests.filter((request) =>
			request.url.startsWith('https://oss.example.com/'),
		)
		expect(partPuts).toHaveLength(3)
		expect(partPuts.map((request) => (request.body as ArrayBuffer).byteLength)).toEqual([
			4, 4, 2,
		])
		expect(partPuts[0].headers?.Authorization).toBe('sig-1')
		expect(partPuts[0].headers?.['X-Oss-Date']).toBe('date')

		const finishBody = JSON.parse(requests.at(-1)!.body as string)
		expect(finishBody.task_id).toBe('task-1')
		expect(finishBody.part_info_list.map((part: { etag: string }) => part.etag)).toEqual([
			'etag-1',
			'etag-2',
			'etag-3',
		])
	})

	it('skips the upload when the server reports a rapid upload', async () => {
		const http: QuarkHttpFn = async (request) => {
			expect(request.url).toContain('/open/v1/file/upload_pre')
			return json({ finish: true, task_id: 'task-1', fid: 'existing-fid' }) as never
		}
		const client = new QuarkClient({ credentials: { ...CREDENTIALS }, http })

		const result = await client.upload({
			parentFid: '0',
			name: 'note.md',
			data: new ArrayBuffer(4),
			md5: 'm',
			sha1: 's',
		})
		expect(result).toEqual({ fid: 'existing-fid', rapidUpload: true })
	})
})
