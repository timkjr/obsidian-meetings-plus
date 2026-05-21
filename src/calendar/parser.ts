import ICAL from "ical.js";
import { CalendarConfig, Meeting } from "../types";

const MEETING_URL_PATTERNS: RegExp[] = [
	/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+/i,
	/https:\/\/[a-z0-9.-]*zoom\.us\/j\/[^\s"'<>]+/i,
	/https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s"'<>]*)?/i,
	/https:\/\/[a-z0-9.-]*webex\.com\/(?:meet|wbxmjs|join)\/[^\s"'<>]+/i,
];

const GENERIC_URL = /https?:\/\/[^\s"'<>]+/i;

const MAX_RECURRENCE_OCCURRENCES = 500;

interface AttendeeProperty {
	name: string;
	getFirstValue(): unknown;
	getParameter(name: string): string | undefined;
}

interface MinimalComponent {
	getFirstPropertyValue<T>(name: string): T | null;
	getAllProperties(name?: string): AttendeeProperty[];
}

interface MinimalTime {
	toJSDate(): Date;
	isDate: boolean;
}

interface MinimalEvent {
	uid: string;
	summary: string;
	location: string;
	description: string;
	organizer: string;
	startDate: MinimalTime;
	endDate: MinimalTime;
	component: MinimalComponent;
	isRecurring(): boolean;
	iterator(start?: MinimalTime): { next(): MinimalTime | null };
	getOccurrenceDetails(time: MinimalTime): {
		startDate: MinimalTime;
		endDate: MinimalTime;
	};
}

export interface ParseOptions {
	calendar: CalendarConfig;
	windowStart: Date;
	windowEnd: Date;
}

export function parseICS(ics: string, opts: ParseOptions): Meeting[] {
	const { calendar, windowStart, windowEnd } = opts;

	const jcal = ICAL.parse(ics);
	const root = new ICAL.Component(jcal);

	for (const vtz of root.getAllSubcomponents("vtimezone")) {
		const tzid = vtz.getFirstPropertyValue<string>("tzid");
		if (tzid && !ICAL.TimezoneService.has(tzid)) {
			try {
				ICAL.TimezoneService.register(vtz);
			} catch {
				/* ignore */
			}
		}
	}

	const meetings: Meeting[] = [];
	const seen = new Set<string>();
	const windowStartTime = ICAL.Time.fromJSDate(windowStart, false);

	for (const vevent of root.getAllSubcomponents("vevent")) {
		const event = new ICAL.Event(vevent) as unknown as MinimalEvent;
		const status = vevent.getFirstPropertyValue<string>("status");
		if (status === "CANCELLED") continue;

		if (event.isRecurring()) {
			const iter = event.iterator(
				windowStartTime as unknown as MinimalTime
			);
			let count = 0;
			while (count < MAX_RECURRENCE_OCCURRENCES) {
				const next = iter.next();
				if (!next) break;
				const startDate = next.toJSDate();
				if (startDate >= windowEnd) break;
				count++;
				let details;
				try {
					details = event.getOccurrenceDetails(next);
				} catch {
					continue;
				}
				const start = details.startDate.toJSDate();
				const end = details.endDate.toJSDate();
				if (end <= windowStart) continue;
				const meeting = buildMeeting(event, start, end, calendar);
				if (acceptable(meeting, calendar, seen)) meetings.push(meeting);
			}
		} else {
			const start = event.startDate.toJSDate();
			const end = event.endDate.toJSDate();
			if (end <= windowStart || start >= windowEnd) continue;
			const meeting = buildMeeting(event, start, end, calendar);
			if (acceptable(meeting, calendar, seen)) meetings.push(meeting);
		}
	}

	meetings.sort((a, b) => a.start.getTime() - b.start.getTime());
	return meetings;
}

function acceptable(
	meeting: Meeting,
	calendar: CalendarConfig,
	seen: Set<string>
): boolean {
	if (calendar.excludeAllDay && meeting.allDay) return false;
	if (seen.has(meeting.dedupKey)) return false;
	seen.add(meeting.dedupKey);
	return true;
}

function buildMeeting(
	event: MinimalEvent,
	start: Date,
	end: Date,
	calendar: CalendarConfig
): Meeting {
	const allDay = Boolean(event.startDate?.isDate);
	const title = (event.summary ?? "").toString().trim() || "(no title)";
	const location = (event.location ?? "").toString();
	const description = stripHTML((event.description ?? "").toString());
	const organizer = cleanContact(String(event.organizer ?? ""));

	const attendees: string[] = [];
	for (const prop of event.component.getAllProperties("attendee")) {
		const cn = prop.getParameter("cn");
		if (cn) {
			attendees.push(cn);
			continue;
		}
		const v = prop.getFirstValue();
		if (typeof v === "string") attendees.push(cleanContact(v));
	}

	const teamsUrl = event.component.getFirstPropertyValue<string>(
		"x-microsoft-skypeteamsmeetingurl"
	);
	const meetingUrl =
		(teamsUrl && String(teamsUrl)) ||
		detectMeetingUrl(location) ||
		detectMeetingUrl(description) ||
		detectGenericUrl(description) ||
		detectGenericUrl(location) ||
		"";

	const startISO = start.toISOString().slice(0, 10);
	const dedupKey = `${calendar.id}::${event.uid}::${startISO}`;

	return {
		dedupKey,
		uid: event.uid,
		calendarId: calendar.id,
		title,
		start,
		end,
		allDay,
		location,
		description,
		organizer,
		attendees,
		meetingUrl,
	};
}

function detectMeetingUrl(text: string): string {
	if (!text) return "";
	for (const re of MEETING_URL_PATTERNS) {
		const m = re.exec(text);
		if (m) return m[0];
	}
	return "";
}

function detectGenericUrl(text: string): string {
	if (!text) return "";
	const m = GENERIC_URL.exec(text);
	return m ? m[0] : "";
}

function stripHTML(input: string): string {
	if (!input) return "";
	return input
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\r\n/g, "\n")
		.trim();
}

function cleanContact(raw: string): string {
	if (!raw) return "";
	return raw.replace(/^mailto:/i, "");
}
