import { moment, setIcon } from "obsidian";
import { CalendarConfig, CalendarStatus } from "../../types";

export interface StatusHeaderOptions {
	parent: HTMLElement;
	calendars: CalendarConfig[];
	statuses: CalendarStatus[];
	onRefresh: () => void;
	onOpenSettings: () => void;
}

export function renderStatusHeader(opts: StatusHeaderOptions): void {
	const root = opts.parent.createDiv({ cls: "calendar-plus-status" });

	const left = root.createDiv({ cls: "calendar-plus-status-left" });
	left.createDiv({
		cls: "calendar-plus-status-title",
		text: moment().format("dddd, MMM D"),
	});
	left.createDiv({
		cls: "calendar-plus-status-sub",
		text: summarizeStatus(opts.statuses),
	});

	const actions = root.createDiv({ cls: "calendar-plus-status-actions" });
	const refresh = actions.createEl("button", {
		cls: "calendar-plus-icon-btn",
		attr: { "aria-label": "Refresh calendars" },
	});
	setIcon(refresh, "refresh-cw");
	refresh.addEventListener("click", () => opts.onRefresh());

	const settings = actions.createEl("button", {
		cls: "calendar-plus-icon-btn",
		attr: { "aria-label": "Open plugin settings" },
	});
	setIcon(settings, "settings");
	settings.addEventListener("click", () => opts.onOpenSettings());
}

function summarizeStatus(statuses: CalendarStatus[]): string {
	if (statuses.length === 0) return "No calendars yet";
	const errors = statuses.filter((s) => s.status.kind === "error");
	if (errors.length > 0) {
		return errors.length === 1
			? `One calendar failed to fetch`
			: `${errors.length} calendars failed to fetch`;
	}
	const fetching = statuses.some((s) => s.status.kind === "fetching");
	if (fetching) return "Fetching…";
	const last = statuses
		.map((s) =>
			s.status.kind === "success" ? s.status.fetchedAt : 0
		)
		.reduce((a, b) => Math.max(a, b), 0);
	if (last === 0) return "Not fetched yet";
	return `Last fetched ${moment(last).fromNow()}`;
}
