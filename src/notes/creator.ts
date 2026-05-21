import { App, Notice, TFile, normalizePath } from "obsidian";
import { CalendarConfig, Meeting } from "../types";
import { renderTemplate, sanitizeFilename } from "./template";
import { findExistingNote } from "./duplicate-detector";
import { runTemplaterIfAvailable } from "../integrations/templater";

export interface CreateOptions {
	app: App;
	meeting: Meeting;
	calendar: CalendarConfig;
	runTemplater: boolean;
	openInNewPane: boolean;
}

export async function createOrOpenMeetingNote(
	opts: CreateOptions
): Promise<TFile | null> {
	const { app, meeting, calendar } = opts;

	const existing = findExistingNote(app, meeting.dedupKey);
	if (existing) {
		await openFile(app, existing, opts.openInNewPane);
		return existing;
	}

	if (!calendar.createNotes) {
		new Notice(
			`Meetings Plus: standalone notes disabled for "${calendar.name}"`
		);
		return null;
	}

	const folder = (calendar.folder || "").trim();
	if (folder) await ensureFolder(app, folder);

	const titleBody = renderTemplate(calendar.titlePattern, {
		meeting,
		calendar,
	});
	const baseName = sanitizeFilename(titleBody) || "Untitled meeting";
	const path = await uniquePath(
		app,
		joinPath(folder, `${baseName}.md`)
	);

	const body = renderTemplate(calendar.template, { meeting, calendar });
	const file = await app.vault.create(path, body);

	if (opts.runTemplater) {
		try {
			await runTemplaterIfAvailable(app, file);
		} catch (e) {
			console.warn("[Meetings Plus] Templater post-processing failed", e);
		}
	}

	await openFile(app, file, opts.openInNewPane);
	return file;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const normalized = normalizePath(folder);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing) return;
	try {
		await app.vault.createFolder(normalized);
	} catch {
		/* already exists or race */
	}
}

function joinPath(folder: string, name: string): string {
	if (!folder) return normalizePath(name);
	return normalizePath(`${folder}/${name}`);
}

async function uniquePath(app: App, path: string): Promise<string> {
	if (!app.vault.getAbstractFileByPath(path)) return path;
	const dot = path.lastIndexOf(".");
	const stem = dot > 0 ? path.slice(0, dot) : path;
	const ext = dot > 0 ? path.slice(dot) : "";
	let i = 2;
	while (i < 1000) {
		const candidate = `${stem} (${i})${ext}`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
		i++;
	}
	return path;
}

async function openFile(
	app: App,
	file: TFile,
	newPane: boolean
): Promise<void> {
	const leaf = app.workspace.getLeaf(newPane ? "tab" : false);
	await leaf.openFile(file);
}
