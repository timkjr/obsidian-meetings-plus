import { ItemView, Notice, WorkspaceLeaf, moment, setIcon } from "obsidian";
import MeetingsPlusPlugin from "../main";
import {
	PLUGIN_NAME,
	VIEW_TYPE_MEETINGS_PLUS,
} from "../constants";
import {
	CalendarConfig,
	CalendarStatus,
	Meeting,
} from "../types";
import { findExistingNote } from "../notes/duplicate-detector";
import {
	buildRowContextMenu,
	renderMeetingRow,
} from "./components/meeting-row";
import { renderStatusHeader } from "./components/status-header";
import { renderCurrentMeeting } from "./components/current-meeting";

const IMMINENT_WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EARLIER_TODAY_KEY = "__earlier_today__";

export class MeetingsPlusView extends ItemView {
	private collapsed: Record<string, boolean> = {};
	private focusedDay: string = dayKey(new Date());
	private unsubRefresh: (() => void) | null = null;
	private rerenderTimer: number | null = null;
	private pendingScrollKey: string | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: MeetingsPlusPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_MEETINGS_PLUS;
	}

	getDisplayText(): string {
		return PLUGIN_NAME;
	}

	getIcon(): string {
		return "calendar-clock";
	}

	onOpen(): Promise<void> {
		const startedUnsub = this.plugin.manager.events.on(
			"refresh:started",
			() => this.render()
		);
		const completedUnsub = this.plugin.manager.events.on(
			"refresh:completed",
			() => this.render()
		);
		this.unsubRefresh = () => {
			startedUnsub();
			completedUnsub();
		};

		this.rerenderTimer = window.setInterval(
			() => this.render(),
			60_000
		);

		this.render();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.unsubRefresh?.();
		this.unsubRefresh = null;
		if (this.rerenderTimer !== null) {
			window.clearInterval(this.rerenderTimer);
			this.rerenderTimer = null;
		}
		this.contentEl.empty();
		return Promise.resolve();
	}

	render(): void {
		this.contentEl.empty();
		const root = this.contentEl.createDiv({
			cls: "meetings-plus-container",
		});

		const calendars = this.plugin.settings.calendars;
		const statuses: CalendarStatus[] = calendars.map((c) => ({
			calendarId: c.id,
			status: this.plugin.manager.getStatus(c.id),
		}));

		const lookAhead = Math.max(1, this.plugin.settings.lookAheadDays);
		const now = Date.now();
		const today = startOfDay(new Date(now));
		const todayKey = dayKey(today);
		const maxKey = dayKey(new Date(today.getTime() + (lookAhead - 1) * DAY_MS));

		// Clamp focusedDay if it fell out of the window
		if (this.focusedDay < todayKey || this.focusedDay > maxKey) {
			this.focusedDay = todayKey;
		}

		renderStatusHeader({
			parent: root,
			calendars,
			statuses,
			lookAheadDays: lookAhead,
			focusedDay: this.focusedDay,
			today: todayKey,
			onRefresh: () => {
				void this.plugin.manager.refreshAll();
			},
			onOpenSettings: () => this.openSettings(),
			onPickDay: (k) => this.jumpToDay(k),
		});

		if (calendars.length === 0) {
			this.renderEmptyState(root);
			return;
		}

		const errorCalendars = statuses.filter(
			(s) => s.status.kind === "error"
		);
		if (errorCalendars.length > 0) {
			this.renderErrors(root, errorCalendars, calendars);
		}

		const meetings = this.visibleMeetings();
		const calIndex = indexById(calendars);

		const dayDates: Date[] = [];
		const dayKeys: string[] = [];
		for (let i = 0; i < lookAhead; i++) {
			const d = new Date(today.getTime() + i * DAY_MS);
			dayDates.push(d);
			dayKeys.push(dayKey(d));
		}

		const byDay = new Map<string, Meeting[]>();
		for (const m of meetings) {
			const k = dayKey(m.start);
			if (!byDay.has(k)) byDay.set(k, []);
			byDay.get(k)!.push(m);
		}

		const todays = byDay.get(todayKey) ?? [];
		const current = todays.find(
			(m) =>
				m.start.getTime() <= now + IMMINENT_WINDOW_MS &&
				m.end.getTime() > now
		);
		if (current) {
			renderCurrentMeeting({
				parent: root,
				meeting: current,
				calendar: calIndex.get(current.calendarId),
				hasNote: this.hasNote(current),
				onOpenNote: (m) => this.activate(m),
				onOpenLink: current.meetingUrl
					? (m) => this.openLink(m)
					: null,
			});
		}

		const upcomingToday = todays.filter(
			(m) =>
				m.end.getTime() > now &&
				(!current || m.dedupKey !== current.dedupKey)
		);
		this.renderDaySection(
			root,
			todayKey,
			todayKey,
			false,
			"Today",
			upcomingToday,
			calIndex
		);

		const earlier = todays.filter((m) => m.end.getTime() <= now);
		if (earlier.length > 0) {
			this.renderDaySection(
				root,
				null,
				EARLIER_TODAY_KEY,
				true,
				"Earlier today",
				earlier,
				calIndex
			);
		}

		for (let i = 1; i < dayKeys.length; i++) {
			const k = dayKeys[i]!;
			const date = dayDates[i]!;
			const label = dayLabel(date, false, i === 1);
			const dayMeetings = byDay.get(k) ?? [];
			this.renderDaySection(
				root,
				k,
				k,
				true,
				label,
				dayMeetings,
				calIndex
			);
		}

		if (todays.length === 0) {
			const anyFuture = dayKeys
				.slice(1)
				.some((k) => (byDay.get(k) ?? []).length > 0);
			if (!anyFuture) {
				root.createDiv({
					cls: "meetings-plus-empty",
					text: "Nothing scheduled.",
				});
			}
		}

		if (this.pendingScrollKey) {
			const target = this.pendingScrollKey;
			this.pendingScrollKey = null;
			requestAnimationFrame(() => {
				const el = this.contentEl.querySelector(
					`[data-day="${target}"]`
				);
				if (el instanceof HTMLElement) {
					el.scrollIntoView({ behavior: "smooth", block: "start" });
				}
			});
		}
	}

	private renderEmptyState(parent: HTMLElement): void {
		const box = parent.createDiv({ cls: "meetings-plus-empty-cta" });
		box.createEl("p", {
			text: "Add a calendar to start seeing meetings here.",
		});
		const btn = box.createEl("button", {
			cls: "mod-cta",
			text: "Open settings",
		});
		btn.addEventListener("click", () => this.openSettings());
	}

	private renderErrors(
		parent: HTMLElement,
		errors: CalendarStatus[],
		calendars: CalendarConfig[]
	): void {
		const wrap = parent.createDiv({ cls: "meetings-plus-errors" });
		for (const e of errors) {
			if (e.status.kind !== "error") continue;
			const cal = calendars.find((c) => c.id === e.calendarId);
			wrap.createDiv({
				cls: "meetings-plus-error-row",
				text: `${cal?.name ?? "Calendar"}: ${e.status.message}`,
			});
		}
	}

	private renderDaySection(
		parent: HTMLElement,
		domDayKey: string | null,
		collapseKey: string,
		defaultCollapsed: boolean,
		title: string,
		meetings: Meeting[],
		calIndex: Map<string, CalendarConfig>
	): void {
		const isCollapsed = this.collapsed[collapseKey] ?? defaultCollapsed;

		const section = parent.createDiv({
			cls: "meetings-plus-section meetings-plus-day-section",
		});
		if (domDayKey) section.setAttribute("data-day", domDayKey);
		if (isCollapsed) section.addClass("meetings-plus-collapsed");
		if (meetings.length === 0) section.addClass("meetings-plus-day-empty");

		const header = section.createDiv({
			cls: "meetings-plus-section-header",
		});
		const chevron = header.createSpan({ cls: "meetings-plus-chevron" });
		setIcon(chevron, "chevron-down");
		header.createSpan({
			cls: "meetings-plus-section-title",
			text: title,
		});
		header.createSpan({
			cls: "meetings-plus-section-count",
			text: String(meetings.length),
		});
		header.addEventListener("click", () => {
			this.collapsed[collapseKey] = !isCollapsed;
			this.render();
		});

		const body = section.createDiv({ cls: "meetings-plus-section-body" });
		for (const meeting of meetings) {
			renderMeetingRow({
				parent: body,
				meeting,
				calendar: calIndex.get(meeting.calendarId),
				hasNote: this.hasNote(meeting),
				onActivate: (m) => this.activate(m),
				onContextMenu: (m, evt) => this.showContextMenu(m, evt),
			});
		}
	}

	private jumpToDay(k: string): void {
		this.focusedDay = k;
		this.collapsed[k] = false;
		this.pendingScrollKey = k;
		this.render();
	}

	private hasNote(meeting: Meeting): boolean {
		return Boolean(findExistingNote(this.app, meeting.dedupKey));
	}

	private visibleMeetings(): Meeting[] {
		const now = Date.now();
		const skipped = new Set(
			this.plugin.settings.skippedToday
				.filter((s) => s.until > now)
				.map((s) => s.key)
		);
		return this.plugin.manager
			.getAllMeetings()
			.filter((m) => !skipped.has(m.dedupKey));
	}

	private activate(meeting: Meeting): void {
		void this.plugin.openOrCreateNote(meeting);
	}

	private openLink(meeting: Meeting): void {
		if (!meeting.meetingUrl) return;
		window.open(meeting.meetingUrl, "_blank");
	}

	private showContextMenu(meeting: Meeting, evt: MouseEvent): void {
		const menu = buildRowContextMenu(meeting, {
			onCreateOrOpen: () => this.activate(meeting),
			onOpenLink: meeting.meetingUrl
				? () => this.openLink(meeting)
				: null,
			onCopyLink: meeting.meetingUrl
				? () => {
						void navigator.clipboard.writeText(meeting.meetingUrl);
						new Notice("Meeting link copied");
					}
				: null,
			onSkip: () => {
				const until = endOfDay(new Date()).getTime();
				this.plugin.settings.skippedToday.push({
					key: meeting.dedupKey,
					until,
				});
				void this.plugin.saveSettings();
				this.render();
			},
		});
		menu.showAtMouseEvent(evt);
	}

	private openSettings(): void {
		const setting = (
			this.app as unknown as {
				setting?: {
					open: () => void;
					openTabById: (id: string) => void;
				};
			}
		).setting;
		if (setting) {
			setting.open();
			setting.openTabById(this.plugin.manifest.id);
		}
	}
}

function indexById(
	calendars: CalendarConfig[]
): Map<string, CalendarConfig> {
	const map = new Map<string, CalendarConfig>();
	for (const c of calendars) map.set(c.id, c);
	return map;
}

function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

function endOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(23, 59, 59, 999);
	return x;
}

export function dayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${dd}`;
}

function dayLabel(d: Date, isToday: boolean, isTomorrow: boolean): string {
	if (isToday) return "Today";
	if (isTomorrow) return "Tomorrow";
	return moment(d).format("ddd, MMM D");
}
