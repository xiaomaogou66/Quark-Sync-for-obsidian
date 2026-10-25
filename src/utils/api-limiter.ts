import Bottleneck from 'bottleneck'

/**
 * Shared ceiling for backend requests.
 *
 * Every WebDAV gateway call goes through here (via
 * `createRateLimitedWebDAVClient`), so this is also the hard cap for the
 * traversal worker pool. A gateway such as OpenList or Alist happily serves a
 * handful of parallel `PROPFIND`s — serialising them made a full walk of a
 * 500-directory vault take twelve minutes instead of two.
 *
 * `minTime` stays small: it only needs to keep the request rate from spiking
 * when several workers start at the same instant.
 */
export const apiLimiter = new Bottleneck({
	maxConcurrent: 6,
	minTime: 20,
})
