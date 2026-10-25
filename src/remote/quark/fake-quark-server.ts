import type { QuarkHttpFn, QuarkHttpRequest, QuarkHttpResponse } from './http'

interface FakeRequestBody {
	parent_fid?: string
	pdir_fid?: string
	dir_path?: string
	file_name?: string
	sha1?: string
	size?: number
	l_updated_at?: number
	task_id?: string
	part_info_list?: Array<{ part_number: number }>
	fid?: string
	fid_list?: string[]
	to_pdir_fid?: string
}

export interface FakeNode {
	fid: string
	parentFid: string
	name: string
	isDir: boolean
	content: string
	mtime: number
}

const sha1Of = async (content: string) => {
	const digest = await crypto.subtle.digest(
		'SHA-1',
		new TextEncoder().encode(content),
	)
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * In-memory stand-in for the Quark open API.
 *
 * Mirrors the response shapes the client parses, including the part-upload
 * handshake and `same_path_reuse` rapid uploads, so the adapter can be tested
 * without live credentials.
 */
export function createFakeQuarkServer() {
	const nodes = new Map<string, FakeNode>()
	const requests: QuarkHttpRequest[] = []
	const parts = new Map<string, Map<number, string>>()
	const pending = new Map<
		string,
		{ parentFid: string; name: string; mtime: number; size: number }
	>()
	let nextId = 1
	let nextTask = 1

	const newFid = () => `fid-${nextId++}`

	const addNode = (node: FakeNode) => {
		nodes.set(node.fid, node)
		return node
	}

	const server = {
		get http(): QuarkHttpFn {
			return async (request) => handle(request)
		},
		addDir(fid: string, parentFid: string, name: string) {
			addNode({
				fid,
				parentFid,
				name,
				isDir: true,
				content: '',
				mtime: 1,
			})
		},
		addFile(fid: string, parentFid: string, name: string, content: string) {
			addNode({ fid, parentFid, name, isDir: false, content, mtime: 1 })
		},
		listDir(fid: string) {
			return [...nodes.values()]
				.filter((node) => node.parentFid === fid)
				.sort((a, b) => a.name.localeCompare(b.name))
		},
		fidOf(path: string) {
			const segments = path.split('/').filter(Boolean)
			let parentFid = '0'
			let current: FakeNode | undefined
			for (const segment of segments) {
				current = [...nodes.values()].find(
					(node) => node.parentFid === parentFid && node.name === segment,
				)
				if (!current) {
					throw new Error(`fake server: missing ${path}`)
				}
				parentFid = current.fid
			}
			return current!.fid
		},
		contentOf(path: string) {
			return nodes.get(server.fidOf(path))?.content
		},
		async contentHashOf(fid: string) {
			return await sha1Of(server.node(fid).content)
		},
		node(fid: string) {
			const node = nodes.get(fid)
			if (!node) {
				throw new Error(`fake server: missing fid ${fid}`)
			}
			return node
		},
		countRequests(fragment: string) {
			return requests.filter((request) => request.url.includes(fragment)).length
		},
	}

	const ok = (data: unknown): QuarkHttpResponse => ({
		status: 200,
		headers: {},
		text: JSON.stringify({ status: 200, errno: 0, data }),
		arrayBuffer: new ArrayBuffer(0),
	})

	const fail = (errno: number, message: string): QuarkHttpResponse => ({
		status: 200,
		headers: {},
		text: JSON.stringify({ status: -1, errno, error_info: message, data: null }),
		arrayBuffer: new ArrayBuffer(0),
	})

	const decodeBody = (body: ArrayBuffer | string | undefined) =>
		typeof body === 'string'
			? body
			: new TextDecoder().decode(body ?? new ArrayBuffer(0))

	const toFile = async (node: FakeNode) => ({
		fid: node.fid,
		parent_fid: node.parentFid,
		filename: node.name,
		file_type: node.isDir ? '0' : '1',
		size: node.isDir ? 0 : node.content.length,
		content_hash: node.isDir ? '' : await sha1Of(node.content),
		updated_at: node.mtime,
	})

	async function handle(
		request: QuarkHttpRequest,
	): Promise<QuarkHttpResponse> {
		requests.push(request)
		const { url, method } = request
		const rawBody: FakeRequestBody =
			typeof request.body === 'string'
				? (JSON.parse(request.body) as FakeRequestBody)
				: {}
		const body = {
			...rawBody,
			parent_fid: rawBody.parent_fid ?? '',
			pdir_fid: rawBody.pdir_fid ?? '',
			dir_path: rawBody.dir_path ?? '',
			file_name: rawBody.file_name ?? '',
			sha1: rawBody.sha1 ?? '',
			size: rawBody.size ?? 0,
			l_updated_at: rawBody.l_updated_at ?? Date.now(),
			task_id: rawBody.task_id ?? '',
			part_info_list: rawBody.part_info_list ?? [],
			fid: rawBody.fid ?? '',
			fid_list: rawBody.fid_list ?? [],
			to_pdir_fid: rawBody.to_pdir_fid ?? '',
		}

		if (url.startsWith('https://oss.test/')) {
			const [, taskId, partNumber] = /^https:\/\/oss\.test\/([^/]+)\/(\d+)$/.exec(
				url,
			)!
			const bucket = parts.get(taskId) ?? new Map<number, string>()
			bucket.set(Number(partNumber), decodeBody(request.body))
			parts.set(taskId, bucket)
			return {
				status: 200,
				headers: { etag: `etag-${taskId}-${partNumber}` },
				text: '',
				arrayBuffer: new ArrayBuffer(0),
			}
		}

		if (url.startsWith('https://dl.test/')) {
			const fid = url.split('/').pop()!
			const node = nodes.get(fid)
			if (!node) {
				return { status: 404, headers: {}, text: '', arrayBuffer: new ArrayBuffer(0) }
			}
			const range = request.headers?.Range
			if (range) {
				const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!
				const slice = node.content.slice(Number(start), Number(end) + 1)
				return {
					status: 206,
					headers: {},
					text: slice,
					arrayBuffer: new TextEncoder().encode(slice).buffer,
				}
			}
			return {
				status: 200,
				headers: {},
				text: node.content,
				arrayBuffer: new TextEncoder().encode(node.content).buffer,
			}
		}

		if (url.includes('/open/v1/file/list')) {
			const children = await Promise.all(
				[...nodes.values()]
					.filter((node) => node.parentFid === body.parent_fid)
					.sort((a, b) => a.name.localeCompare(b.name))
					.map(toFile),
			)
			return ok({ file_list: children, last_page: true })
		}

		if (url.includes('/open/v1/dir')) {
			const exists = [...nodes.values()].some(
				(node) =>
					node.parentFid === body.pdir_fid &&
					node.name === body.dir_path &&
					node.isDir,
			)
			if (!exists) {
				addNode({
					fid: newFid(),
					parentFid: body.pdir_fid,
					name: body.dir_path,
					isDir: true,
					content: '',
					mtime: Date.now(),
				})
			}
			return ok({})
		}

		if (url.includes('/open/v1/file/upload_pre')) {
			const same = [...nodes.values()].find(
				(node) =>
					node.parentFid === body.pdir_fid &&
					node.name === body.file_name &&
					!node.isDir,
			)
			if (same && (await sha1Of(same.content)) === body.sha1) {
				return ok({ finish: true, task_id: 'rapid', fid: same.fid })
			}
			const taskId = `task-${nextTask++}`
			pending.set(taskId, {
				parentFid: body.pdir_fid,
				name: body.file_name,
				mtime: body.l_updated_at,
				size: body.size,
			})
			return ok({ finish: false, task_id: taskId, part_size: 5 })
		}

		if (url.includes('/open/v1/file/get_upload_urls')) {
			return ok({
				common_headers: {
					'X-Oss-Date': 'date',
					'X-Oss-Content-Sha256': 'sha',
				},
				upload_urls: (body.part_info_list ?? []).map(
					(part) => ({
						part_number: part.part_number,
						upload_url: `https://oss.test/${body.task_id}/${part.part_number}`,
						signature_info: { signature: 'sig' },
					}),
				),
			})
		}

		if (url.includes('/open/v1/file/upload_finish')) {
			const task = pending.get(body.task_id)
			if (!task) {
				return fail(1, 'unknown task')
			}
			const bucket = parts.get(body.task_id) ?? new Map<number, string>()
			const content = [...bucket.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([, chunk]) => chunk)
				.join('')

			const existing = [...nodes.values()].find(
				(node) =>
					node.parentFid === task.parentFid &&
					node.name === task.name &&
					!node.isDir,
			)
			if (existing) {
				existing.content = content
				existing.mtime = task.mtime
				return ok({ finish: true, fid: existing.fid })
			}
			const node = addNode({
				fid: newFid(),
				parentFid: task.parentFid,
				name: task.name,
				isDir: false,
				content,
				mtime: task.mtime,
			})
			return ok({ finish: true, fid: node.fid })
		}

		if (url.includes('/open/v1/file/get_download_url')) {
			return ok({ fid: body.fid, download_url: `https://dl.test/${body.fid}` })
		}

		if (url.includes('/open/v1/file/delete')) {
			const remove = (fid: string) => {
				for (const node of [...nodes.values()]) {
					if (node.parentFid === fid) {
						remove(node.fid)
					}
				}
				nodes.delete(fid)
			}
			for (const fid of body.fid_list ?? []) {
				remove(fid)
			}
			return ok({})
		}

		if (url.includes('/open/v1/file/move')) {
			for (const fid of body.fid_list ?? []) {
				const node = nodes.get(fid)
				if (node) {
					node.parentFid = body.to_pdir_fid
				}
			}
			return ok({})
		}

		if (url.includes('/open/v1/file/rename')) {
			const node = nodes.get(body.fid)
			if (node) {
				node.name = body.file_name
			}
			return ok({})
		}

		if (url.includes('/open/v1/user/info')) {
			return ok({ user_id: 'user-1' })
		}

		return fail(404, `fake server: unhandled ${method} ${url}`)
	}

	return server
}
