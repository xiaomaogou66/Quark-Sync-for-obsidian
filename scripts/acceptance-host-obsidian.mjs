#!/usr/bin/env node
/**
 * Host-side acceptance run for the built plugin.
 *
 * The upstream `pnpm test:obsidian` harness runs Obsidian inside a microVM
 * (microsandbox), which does not work on every host. This script does the same
 * job with the Obsidian already installed on this machine:
 *
 *   1. build a throwaway vault + throwaway Electron profile under /tmp,
 *   2. copy main.js/manifest.json/styles.css into it,
 *   3. launch Obsidian with a remote-debugging port,
 *   4. drive the renderer over CDP: enable the plugin, assert it loaded
 *      without exceptions, and assert the Quark settings panel renders.
 *
 * Usage: node scripts/acceptance-host-obsidian.mjs [--keep]
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const PLUGIN_ID = 'quark-sync'
const PORT = Number(process.env.ACCEPTANCE_CDP_PORT ?? '9333')
const STARTUP_TIMEOUT_MS = Number(
	process.env.ACCEPTANCE_STARTUP_TIMEOUT_MS ?? '90000',
)
const keep = process.argv.includes('--keep')

const results = []
function record(name, ok, detail = '') {
	results.push({ name, ok, detail })
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function waitForDevtools() {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
			const targets = await response.json()
			const page = targets.find(
				(target) => target.type === 'page' && target.webSocketDebuggerUrl,
			)
			if (page) {
				return page
			}
		} catch {
			// DevTools endpoint not up yet.
		}
		await delay(500)
	}
	throw new Error(`DevTools endpoint did not appear on port ${PORT}`)
}

function createClient(wsUrl) {
	const socket = new WebSocket(wsUrl)
	const pending = new Map()
	const events = []
	let nextId = 1

	socket.addEventListener('message', (event) => {
		const message = JSON.parse(event.data)
		if (message.id !== undefined) {
			const entry = pending.get(message.id)
			if (entry) {
				pending.delete(message.id)
				message.error
					? entry.reject(new Error(JSON.stringify(message.error)))
					: entry.resolve(message.result)
			}
			return
		}
		events.push(message)
	})

	const ready = new Promise((resolveReady, rejectReady) => {
		socket.addEventListener('open', () => resolveReady())
		socket.addEventListener('error', () =>
			rejectReady(new Error('CDP socket error')),
		)
	})

	const send = (method, params = {}) =>
		new Promise((resolveSend, rejectSend) => {
			const id = nextId++
			pending.set(id, { resolve: resolveSend, reject: rejectSend })
			socket.send(JSON.stringify({ id, method, params }))
		})

	return { ready, send, events, close: () => socket.close() }
}

async function evaluate(client, expression) {
	const result = await client.send('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true,
		includeCommandLineAPI: true,
	})
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text,
		)
	}
	return result.result.value
}

/** Fails fast when main.js predates the newest source file. */
async function newestSourceMtime() {
	let newest = 0
	const walk = async (dir) => {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name)
			if (entry.isDirectory()) {
				await walk(full)
			} else if (/\.(ts|tsx|css|json|mjs)$/.test(entry.name)) {
				newest = Math.max(newest, (await stat(full)).mtimeMs)
			}
		}
	}
	await walk(join(ROOT, 'src'))
	return newest
}

async function main() {
	const workDir = await mkdtemp(join(tmpdir(), 'quark-obsidian-accept-'))
	const vault = join(workDir, 'vault')
	const profile = join(workDir, 'profile')
	const pluginDir = join(vault, '.obsidian', 'plugins', PLUGIN_ID)

	try {
		await mkdir(pluginDir, { recursive: true })
		await mkdir(join(vault, '.obsidian'), { recursive: true })
		for (const file of ['main.js', 'manifest.json', 'styles.css']) {
			await cp(join(ROOT, file), join(pluginDir, file))
		}
		await writeFile(join(vault, 'welcome.md'), '# acceptance vault\n')
		await writeFile(
			join(vault, '.obsidian', 'community-plugins.json'),
			JSON.stringify([PLUGIN_ID], null, '\t'),
		)
		await writeFile(
			join(vault, '.obsidian', 'app.json'),
			JSON.stringify({ promptDelete: false }),
		)

		const [bundleStat, newestSource] = await Promise.all([
			stat(join(ROOT, 'main.js')),
			newestSourceMtime(),
		])
		record(
			'build is up to date',
			bundleStat.mtimeMs >= newestSource,
			bundleStat.mtimeMs >= newestSource
				? 'main.js is newer than src'
				: 'main.js is stale — run `pnpm build` first',
		)

		const manifest = JSON.parse(
			await readFile(join(ROOT, 'manifest.json'), 'utf8'),
		)
		record(
			'manifest identity',
			manifest.id === PLUGIN_ID,
			`id=${manifest.id} name=${manifest.name}`,
		)

		await mkdir(profile, { recursive: true })
		// Obsidian 1.14 ignores `--vault` for the desktop app and would create a
		// default vault in the user's home directory, so the vault is registered
		// through the profile's obsidian.json instead.
		await writeFile(
			join(profile, 'obsidian.json'),
			JSON.stringify({
				vaults: {
					[randomBytes(8).toString('hex')]: {
						path: vault,
						ts: Date.now(),
						open: true,
					},
				},
			}),
		)

		const child = spawn(
			'obsidian',
			[
				'--no-sandbox',
				`--user-data-dir=${profile}`,
				`--remote-debugging-port=${PORT}`,
			],
			{ stdio: ['ignore', 'pipe', 'pipe'], detached: false },
		)
		let stderr = ''
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString()
		})
		child.stdout.on('data', () => {})

		let client
		try {
			const page = await waitForDevtools()
			client = createClient(page.webSocketDebuggerUrl)
			await client.ready
			await client.send('Runtime.enable')
			await client.send('Log.enable')

			// Give the workspace a moment to finish loading before driving it.
			for (let i = 0; i < 60; i++) {
				const ready = await evaluate(
					client,
					`Boolean(window.app && window.app.workspace && window.app.plugins)`,
				)
				if (ready) break
				await delay(500)
			}

			const version = await evaluate(
				client,
				`window.app.version ?? 'unknown'`,
			)
			record('obsidian loaded', true, `version ${version}`)

			const vaultPath = await evaluate(
				client,
				`app.vault.adapter.basePath ?? ''`,
			)
			record(
				'throwaway vault opened',
				typeof vaultPath === 'string' && vaultPath === vault,
				String(vaultPath),
			)

			// A fresh vault shows Obsidian's "trust folder / trust author" prompt,
			// which must be dismissed or it swallows every modal we open afterwards.
			// A fresh vault shows Obsidian's "trust folder / trust author" prompt; while
			// it is open, `enablePluginAndSave` silently defers loading the plugin.
			// Dismiss it first, and keep checking in case it appears late.
			const trustDismissed = await evaluate(
				client,
				`(async () => {
					let dismissed = 0;
					for (let attempt = 0; attempt < 10; attempt++) {
						const dialogs = Array.from(
							document.querySelectorAll('.modal-container .modal, .modal'),
						).filter((el) => /trust|信任/i.test(el.className + el.textContent));
						if (dialogs.length === 0) {
							await new Promise((r) => setTimeout(r, 300));
							continue;
						}
						for (const dialog of dialogs) {
							const primary = dialog.querySelector('button.mod-cta') || dialog.querySelector('button');
							primary?.click();
							dismissed++;
							await new Promise((r) => setTimeout(r, 400));
						}
					}
					return { dismissed, remaining: document.querySelectorAll('.modal').length };
				})()`,
			)
			record(
				'obsidian trust prompt handled',
				trustDismissed?.remaining === 0,
				JSON.stringify(trustDismissed),
			)

			const enabled = await evaluate(
				client,
				`(async () => {
					await app.plugins.setEnable(true);
					await app.plugins.enablePluginAndSave('${PLUGIN_ID}');
					for (let attempt = 0; attempt < 40; attempt++) {
						if (app.plugins.plugins['${PLUGIN_ID}']) {
							return true;
						}
						await new Promise((r) => setTimeout(r, 250));
					}
					return Array.from(app.plugins.enabledPlugins).includes('${PLUGIN_ID}');
				})()`,
			)
			record('plugin enabled', enabled === true)

			const loaded = await evaluate(
				client,
				`(() => {
					const instance = app.plugins.plugins['${PLUGIN_ID}'];
					if (!instance) return { ok: false, reason: 'no instance' };
					const settings = instance.settings ?? {};
					return {
						ok: true,
						manifestId: instance.manifest.id,
						hasQuarkSettings: Boolean(settings.quark),
						quarkKeys: Object.keys(settings.quark ?? {}),
						hasServices: Boolean(instance.remoteBackendService),
						commands: Object.keys(app.commands.commands).filter((id) => id.startsWith('${PLUGIN_ID}:')),
					};
				})()`,
			)
			record(
				'plugin onload',
				loaded?.ok === true,
				loaded ? JSON.stringify(loaded) : 'no result',
			)
			if (loaded?.ok) {
				record(
					'quark settings wired',
					loaded.hasQuarkSettings === true &&
						loaded.quarkKeys.includes('appId') &&
						loaded.quarkKeys.includes('overwriteMode'),
					loaded.quarkKeys.join(','),
				)
				record(
					'remote backend service',
					loaded.hasServices === true,
				)
				record(
					'commands registered',
					Array.isArray(loaded.commands) && loaded.commands.length > 0,
					loaded.commands?.slice(0, 3).join(', '),
				)
			}

			// Settings tab: open it and look for the Quark panel fields.
			const settingsUi = await evaluate(
				client,
				`(async () => {
					app.setting.open();
					app.setting.openTabById('${PLUGIN_ID}');
					await new Promise((r) => setTimeout(r, 1500));
					const text = app.setting.activeTab?.containerEl?.textContent ?? '';
					const rows = app.setting.activeTab?.containerEl?.querySelectorAll('.setting-item').length ?? 0;
					return { rows, hasAppId: text.includes('AppID'), hasRootFid: text.includes('FID'), hasQuark: /夸克|Quark/i.test(text) };
				})()`,
			)
			record(
				'settings tab renders Quark panel',
				settingsUi?.hasAppId === true && settingsUi?.hasQuark === true,
				`rows=${settingsUi?.rows}`,
			)

			// Switch to the WebDAV gateway provider and confirm its panel renders,
			// then switch back so the persisted settings stay on the default.
			const providerSwitch = await evaluate(
				client,
				`(async () => {
					const instance = app.plugins.plugins['${PLUGIN_ID}'];
					const original = instance.settings.remoteProvider;
					instance.settings.remoteProvider = 'webdav';
					app.setting.activeTab.display();
					await new Promise((r) => setTimeout(r, 800));
					const text = app.setting.activeTab?.containerEl?.textContent ?? '';
					instance.settings.remoteProvider = original;
					app.setting.activeTab.display();
					await new Promise((r) => setTimeout(r, 300));
					return { hasWebdavUrl: /WebDAV (URL|地址)/.test(text), hasBackendPicker: /WebDAV/.test(text) };
				})()`,
			)
			record(
				'webdav gateway panel renders',
				providerSwitch?.hasWebdavUrl === true,
				JSON.stringify(providerSwitch),
			)

			// Remote directory picker. Obsidian 1.14 attaches modals to the active
			// window's document, so the DOM query is unreliable here; assert on the
			// returned modal instance instead (class, rendered text, error state).
			const picker = await evaluate(
				client,
				`(async () => {
					const instance = app.plugins.plugins['${PLUGIN_ID}'];
					instance.settings.remoteProvider = 'webdav';
					instance.settings.webdav.baseUrl = 'http://127.0.0.1:1/dav';
					instance.settings.remoteDir = '/';
					const errors = [];
					const onRejection = (event) => errors.push(String(event.reason?.message ?? event.reason));
					window.addEventListener('unhandledrejection', onRejection);
					const modal = instance.openRemoteDirPicker();
					await new Promise((r) => setTimeout(r, 1500));
					window.removeEventListener('unhandledrejection', onRejection);
					return {
						className: modal?.modalEl?.className ?? '',
						text: (modal?.contentEl?.textContent ?? '').slice(0, 300),
						errors,
					};
				})()`,
			)
			const pickerText = String(picker?.text ?? '')
				.replace(/\s+/g, ' ')
				.trim()
			record(
				'remote directory picker opens',
				String(picker?.className ?? '').includes('quark-sync-dir-picker'),
				String(picker?.className ?? ''),
			)
			record(
				'picker renders breadcrumb and readable state',
				pickerText.length > 10 &&
					/(root|根目录)/i.test(pickerText) &&
					/(Could not list|列出目录失败|Go up|返回上一层|folder|目录)/i.test(
						pickerText,
					),
				`${pickerText.slice(0, 120)}${picker?.errors?.length ? ` errors=${JSON.stringify(picker.errors)}` : ''}`,
			)

			// Reload to prove the plugin survives an unload/load cycle.
			const reload = await evaluate(
				client,
				`(async () => {
					await app.plugins.disablePlugin('${PLUGIN_ID}');
					await app.plugins.enablePlugin('${PLUGIN_ID}');
					return Boolean(app.plugins.plugins['${PLUGIN_ID}']);
				})()`,
			)
			record('disable/enable cycle', reload === true)

			// Known upstream noise: the upstream bundle imports yjs twice, which
			// logs an error-level warning. It is not caused by this plugin's code
			// path, so it must not fail the run — but it stays visible in the log.
			const KNOWN_NOISE = [/Yjs was already imported/]

			const pluginEvents = client.events.filter((event) =>
				JSON.stringify(event.params).includes(PLUGIN_ID),
			)
			const exceptions = pluginEvents.filter(
				(event) => event.method === 'Runtime.exceptionThrown',
			)
			const consoleErrors = pluginEvents
				.filter(
					(event) =>
						event.method === 'Runtime.consoleAPICalled' &&
						event.params.type === 'error',
				)
				.filter((event) => {
					const text = JSON.stringify(event.params.args ?? [])
					return !KNOWN_NOISE.some((pattern) => pattern.test(text))
				})

			record(
				'no uncaught exceptions',
				exceptions.length === 0,
				exceptions.length
					? JSON.stringify(exceptions[0].params).slice(0, 400)
					: '',
			)
			record(
				'no unexpected console errors',
				consoleErrors.length === 0,
				consoleErrors.length
					? JSON.stringify(consoleErrors[0].params).slice(0, 400)
					: `${pluginEvents.length} plugin-tagged event(s), all expected`,
			)
		} finally {
			client?.close()
			child.kill('SIGTERM')
			await delay(1500)
			if (!child.killed) {
				child.kill('SIGKILL')
			}
			if (stderr.trim()) {
				console.log('\n[obsidian stderr]\n' + stderr.trim().split('\n').slice(-15).join('\n'))
			}
		}
	} finally {
		if (keep) {
			console.log(`\nartifacts kept at ${workDir}`)
		} else {
			await rm(workDir, { recursive: true, force: true })
		}
	}

	const failed = results.filter((result) => !result.ok)
	console.log(
		`\n${results.length - failed.length}/${results.length} checks passed`,
	)
	process.exit(failed.length === 0 ? 0 : 1)
}

await main()
