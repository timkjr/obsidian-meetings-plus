import { App, TFile } from "obsidian";

export function findExistingNote(
	app: App,
	dedupKey: string
): TFile | null {
	const files = app.vault.getMarkdownFiles();
	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) continue;
		if (fm["meeting_dedup_key"] === dedupKey) return file;
	}
	return null;
}

export function findNoteByUidAndStart(
	app: App,
	uid: string,
	startISODate: string
): TFile | null {
	const files = app.vault.getMarkdownFiles();
	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) continue;
		if (fm["meeting_uid"] !== uid) continue;
		const start = String(fm["start"] ?? "");
		const date = String(fm["date"] ?? "");
		if (date === startISODate || start.startsWith(startISODate)) {
			return file;
		}
	}
	return null;
}
