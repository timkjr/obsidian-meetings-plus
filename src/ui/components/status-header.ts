import { moment, setIcon } from "obsidian";
import { CalendarConfig, CalendarStatus } from "../../types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StatusHeaderOptions {
	parent: HTMLElement;
	calendars: CalendarConfig[];
	statuses: CalendarStatus[];
	lookAheadDays: number;
	/** YYYY-MM-DD currently focused */
	focusedDay: string;
	/** YYYY-MM-DD of today */
	today: string;
	onRefresh: () => void;
	onOpenSettings: () => void;
	onPickDay: (key: string) => void;
}

export function renderStatusHeader(opts: StatusHeaderOptions): void {
	const root = opts.parent.createDiv({ cls: "meetings-plus-status" });

	const top = root.createDiv({ cls: "meetings-plus-status-top" });
	const left = top.createDiv({ cls: "meetings-plus-status-left" });
	left.createDiv({
		cls: "meetings-plus-status-title",
		text: moment().format("dddd, MMM D"),
	});
	left.createDiv({
		cls: "meetings-plus-status-sub",
		text: summarizeStatus(opts.statuses),
	});

	const actions = top.createDiv({ cls: "meetings-plus-status-actions" });
	const refresh = actions.createEl("button", {
		cls: "meetings-plus-icon-btn",
		attr: { "aria-label": "Refresh calendars" },
	});
	setIcon(refresh, "refresh-cw");
	refresh.addEventListener("click", () => opts.onRefresh());

	const settings = actions.createEl("button", {
		cls: "meetings-plus-icon-btn",
		attr: { "aria-label": "Open plugin settings" },
	});
	setIcon(settings, "settings");
	settings.addEventListener("click", () => opts.onOpenSettings());

	renderDateBar(root, opts);
}

function renderDateBar(parent: HTMLElement, opts: StatusHeaderOptions): void {
	const todayDate = dateFromKey(opts.today);
	const focusedDate = dateFromKey(opts.focusedDay);
	const maxOffset = Math.max(0, opts.lookAheadDays - 1);
	const focusedOffset = Math.round(
		(focusedDate.getTime() - todayDate.getTime()) / DAY_MS
	);
	const maxKey = keyFromDate(
		new Date(todayDate.getTime() + maxOffset * DAY_MS)
	);

	const bar = parent.createDiv({ cls: "meetings-plus-datebar" });

	const prev = bar.createEl("button", {
		cls: "meetings-plus-icon-btn",
		attr: { "aria-label": "Previous day" },
	});
	setIcon(prev, "chevron-left");
	if (focusedOffset <= 0) prev.setAttribute("disabled", "true");
	prev.addEventListener("click", () => {
		if (focusedOffset <= 0) return;
		const next = new Date(focusedDate.getTime() - DAY_MS);
		opts.onPickDay(keyFromDate(next));
	});

	const label = bar.createEl("button", {
		cls: "meetings-plus-datebar-label",
		text: labelFor(focusedDate, opts.today),
	});

	const input = bar.createEl("input", {
		cls: "meetings-plus-datebar-input",
		attr: {
			type: "date",
			min: opts.today,
			max: maxKey,
			value: opts.focusedDay,
			"aria-label": "Jump to date",
		},
	});
	input.addEventListener("change", () => {
		const v = input.value;
		if (!v) return;
		if (v < opts.today || v > maxKey) return;
		opts.onPickDay(v);
	});
	label.addEventListener("click", () => {
		const el = input as HTMLInputElement & {
			showPicker?: () => void;
		};
		if (typeof el.showPicker === "function") {
			el.showPicker();
		} else {
			el.click();
		}
	});

	const next = bar.createEl("button", {
		cls: "meetings-plus-icon-btn",
		attr: { "aria-label": "Next day" },
	});
	setIcon(next, "chevron-right");
	if (focusedOffset >= maxOffset) next.setAttribute("disabled", "true");
	next.addEventListener("click", () => {
		if (focusedOffset >= maxOffset) return;
		const np = new Date(focusedDate.getTime() + DAY_MS);
		opts.onPickDay(keyFromDate(np));
	});

	if (opts.focusedDay !== opts.today) {
		const todayBtn = bar.createEl("button", {
			cls: "meetings-plus-datebar-today",
			text: "Today",
		});
		todayBtn.addEventListener("click", () => opts.onPickDay(opts.today));
	}
}

function labelFor(d: Date, todayKey: string): string {
	const k = keyFromDate(d);
	if (k === todayKey) return moment(d).format("[Today] · ddd, MMM D");
	return moment(d).format("ddd, MMM D");
}

function dateFromKey(k: string): Date {
	const [y, m, d] = k.split("-").map((x) => parseInt(x, 10));
	return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function keyFromDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${dd}`;
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
