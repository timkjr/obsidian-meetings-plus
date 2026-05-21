import { moment, setIcon } from "obsidian";
import { CalendarConfig, Meeting } from "../../types";

export interface CurrentMeetingOptions {
	parent: HTMLElement;
	meeting: Meeting;
	calendar: CalendarConfig | undefined;
	hasNote: boolean;
	onOpenNote: (meeting: Meeting) => void;
	onOpenLink: ((meeting: Meeting) => void) | null;
}

export function renderCurrentMeeting(opts: CurrentMeetingOptions): void {
	const { meeting, calendar, hasNote } = opts;
	const card = opts.parent.createDiv({ cls: "meetings-plus-current" });

	const top = card.createDiv({ cls: "meetings-plus-current-top" });
	const dot = top.createDiv({ cls: "meetings-plus-calendar-dot" });
	if (calendar) dot.style.background = calendar.color;

	const info = top.createDiv({ cls: "meetings-plus-current-info" });
	const startLabel = moment(meeting.start).format("HH:mm");
	const endLabel = moment(meeting.end).format("HH:mm");
	const now = Date.now();
	const status =
		meeting.start.getTime() <= now
			? "Now"
			: `Starts in ${Math.max(
					1,
					Math.round((meeting.start.getTime() - now) / 60_000)
				)} min`;
	info.createDiv({
		cls: "meetings-plus-current-status",
		text: status,
	});
	info.createDiv({
		cls: "meetings-plus-current-title",
		text: meeting.title,
	});
	info.createDiv({
		cls: "meetings-plus-current-time",
		text: `${startLabel}–${endLabel}`,
	});

	const actions = card.createDiv({ cls: "meetings-plus-current-actions" });
	const openBtn = actions.createEl("button", {
		cls: "meetings-plus-current-cta",
		text: hasNote ? "Open note" : "Open note",
	});
	openBtn.addEventListener("click", () => opts.onOpenNote(meeting));

	if (opts.onOpenLink && meeting.meetingUrl) {
		const linkBtn = actions.createEl("button", {
			cls: "meetings-plus-current-link",
			attr: { "aria-label": "Open meeting link" },
		});
		setIcon(linkBtn, "video");
		linkBtn.addEventListener("click", () => opts.onOpenLink!(meeting));
	}
}
