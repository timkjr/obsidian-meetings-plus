import { App, FuzzySuggestModal, TFolder } from "obsidian";

export class FolderSuggestModal extends FuzzySuggestModal<string> {
	constructor(app: App, private readonly onPick: (path: string) => void) {
		super(app);
		this.setPlaceholder("Select a folder…");
	}

	getItems(): string[] {
		const folders: string[] = ["/"];
		const visit = (folder: TFolder) => {
			folders.push(folder.path || "/");
			for (const child of folder.children) {
				if (child instanceof TFolder) visit(child);
			}
		};
		visit(this.app.vault.getRoot());
		return Array.from(new Set(folders));
	}

	getItemText(item: string): string {
		return item;
	}

	onChooseItem(item: string): void {
		this.onPick(item === "/" ? "" : item);
	}
}
