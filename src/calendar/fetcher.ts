import { requestUrl } from "obsidian";

export interface FetchResult {
	body: string;
	status: number;
}

export interface FetchOptions {
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchICS(
	rawUrl: string,
	opts: FetchOptions = {}
): Promise<FetchResult> {
	const normalized = normalizeWebcal(rawUrl);
	const { url, headers } = extractAuth(normalized);
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	const result = await withTimeout(
		requestUrl({
			url,
			method: "GET",
			headers: {
				Accept: "text/calendar, text/plain, */*",
				...headers,
			},
			throw: false,
		}),
		timeoutMs
	);

	if (result.status >= 400) {
		throw new Error(`HTTP ${result.status}`);
	}
	const body = result.text ?? "";
	if (!body.includes("BEGIN:VCALENDAR")) {
		throw new Error("Response is not a valid ICS feed");
	}
	return { body, status: result.status };
}

/**
 * iCloud (and many other calendar apps) hand out `webcal://` URLs that are
 * meant to deep-link into a calendar client. Semantically they're just HTTPS
 * resources, so rewrite the scheme so `requestUrl()` accepts them.
 */
function normalizeWebcal(rawUrl: string): string {
	const trimmed = rawUrl.trim();
	if (/^webcals:\/\//i.test(trimmed)) {
		return trimmed.replace(/^webcals:\/\//i, "https://");
	}
	if (/^webcal:\/\//i.test(trimmed)) {
		return trimmed.replace(/^webcal:\/\//i, "https://");
	}
	return trimmed;
}

interface AuthExtraction {
	url: string;
	headers: Record<string, string>;
}

function extractAuth(rawUrl: string): AuthExtraction {
	try {
		const parsed = new URL(rawUrl);
		if (!parsed.username && !parsed.password) {
			return { url: rawUrl, headers: {} };
		}
		const user = decodeURIComponent(parsed.username);
		const pass = decodeURIComponent(parsed.password);
		parsed.username = "";
		parsed.password = "";
		const token = base64(`${user}:${pass}`);
		return {
			url: parsed.toString(),
			headers: { Authorization: `Basic ${token}` },
		};
	} catch {
		return { url: rawUrl, headers: {} };
	}
}

function base64(input: string): string {
	if (typeof btoa === "function") {
		// Encode UTF-8 → Latin-1 → base64
		return btoa(
			Array.from(new TextEncoder().encode(input))
				.map((b) => String.fromCharCode(b))
				.join("")
		);
	}
	// Node fallback (shouldn't run in Obsidian)
	type B = { from(s: string, enc: string): { toString(enc: string): string } };
	const g = globalThis as unknown as { Buffer?: B };
	if (g.Buffer) {
		return g.Buffer.from(input, "utf-8").toString("base64");
	}
	throw new Error("No base64 encoder available");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = window.setTimeout(
			() => reject(new Error(`Timed out after ${ms}ms`)),
			ms
		);
		p.then(
			(v) => {
				window.clearTimeout(t);
				resolve(v);
			},
			(e) => {
				window.clearTimeout(t);
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		);
	});
}
