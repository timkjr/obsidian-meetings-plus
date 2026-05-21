import { TFile } from "obsidian";

export interface CalendarConfig {
	/** Stable internal ID, generated when calendar is added */
	id: string;
	/** Display name shown in UI */
	name: string;
	/** ICS feed URL (may include basic auth: https://user:pass@host/cal.ics) */
	url: string;
	/** Color hex for visual distinction in the sidebar (e.g. "#4a90e2") */
	color: string;
	/** Enabled / disabled toggle */
	enabled: boolean;
	/** Folder where standalone meeting notes get created */
	folder: string;
	/** Template body — supports {{variable}} substitution */
	template: string;
	/** Note title pattern (e.g. "{{date}} - {{title}}") */
	titlePattern: string;
	/** Tags to add to frontmatter of every note from this calendar */
	tags: string[];
	/** Create a standalone note per meeting */
	createNotes: boolean;
	/** Also append meetings from this calendar to today's daily note */
	appendToDailyNote: boolean;
	/** Filter out all-day events */
	excludeAllDay: boolean;
}

export interface Meeting {
	/** Stable dedup key: combination of ICS UID and recurrence start */
	dedupKey: string;
	/** ICS UID (may repeat across recurrences) */
	uid: string;
	/** Which calendar this meeting came from */
	calendarId: string;
	/** Meeting title (ICS SUMMARY) */
	title: string;
	/** Start datetime */
	start: Date;
	/** End datetime */
	end: Date;
	/** Whether this is an all-day event */
	allDay: boolean;
	/** Location string (ICS LOCATION) */
	location: string;
	/** Description / body (ICS DESCRIPTION) */
	description: string;
	/** Organizer display name */
	organizer: string;
	/** Attendee display names */
	attendees: string[];
	/** Detected Teams / Zoom / Meet / Webex link from description or location */
	meetingUrl: string;
	/** Has the user already created a note for this meeting? */
	existingNote?: TFile;
}

export type FetchStatus =
	| { kind: "idle" }
	| { kind: "fetching"; startedAt: number }
	| { kind: "success"; fetchedAt: number; count: number }
	| { kind: "error"; fetchedAt: number; message: string };

export interface CalendarStatus {
	calendarId: string;
	status: FetchStatus;
}
