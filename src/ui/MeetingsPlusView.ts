import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
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

interface CollapsedState {
	earlier: boolean;
	tomorrow: boolean;
}

export class MeetingsPlusView extends ItemView {
	private collapsed: CollapsedState = { earlier: true, tomorrow: true };
	private unsubRefresh: (() => void) | null = null;
	private rerenderTimer: number | null = null;

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

		renderStatusHeader({
			parent: root,
			calendars,
			statuses,
			onRefresh: () => {
				void this.plugin.manager.refreshAll();
			},
			onOpenSettings: () => this.openSettings(),
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
		const now = Date.now();
		const today = startOfDay(new Date(now));
		const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
		const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);

		const todays = meetings.filter(
			(m) => m.start >= today && m.start < tomorrow
		);
		const tomorrows = meetings.filter(
			(m) => m.start >= tomorrow && m.start < dayAfter
		);

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

		const upcoming = todays.filter(
			(m) => !current || m.dedupKey !== current.dedupKey
		).filter((m) => m.end.getTime() > now);
		const earlier = todays.filter((m) => m.end.getTime() <= now);

		this.renderSection(root, "Up next", upcoming, calIndex, false, null);
		this.renderSection(
			root,
			"Earlier today",
			earlier,
			calIndex,
			true,
			"earlier"
		);
		this.renderSection(
			root,
			"Tomorrow",
			tomorrows,
			calIndex,
			true,
			"tomorrow"
		);

		if (todays.length === 0 && tomorrows.length === 0) {
			root.createDiv({
				cls: "meetings-plus-empty",
				text: "Nothing scheduled.",
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

	private renderSection(
		parent: HTMLElement,
		title: string,
		meetings: Meeting[],
		calIndex: Map<string, CalendarConfig>,
		collapsible: boolean,
		key: "earlier" | "tomorrow" | null
	): void {
		if (meetings.length === 0) return;
		const section = parent.createDiv({ cls: "meetings-plus-section" });
		const isCollapsed = collapsible && key ? this.collapsed[key] : false;
		if (isCollapsed) section.addClass("meetings-plus-collapsed");

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
		if (collapsible && key) {
			header.addEventListener("click", () => {
				this.collapsed[key] = !this.collapsed[key];
				this.render();
			});
		} else {
			chevron.addClass("meetings-plus-chevron-hidden");
		}

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

