import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, setIcon } from 'obsidian';

import { createLinkedChildBoard } from './src/create-board';
import { findParentBoards, inspectBoard, isBoardFile, syncBoard } from './src/rollup';
import {
	DEFAULT_SETTINGS,
	MasterBoardSettings,
	STATUS_KEYS,
	StatusKey,
	formatAliasInput,
	normalizeSettings,
	parseAliasInput,
} from './src/settings';

const KANBAN_VIEW_TYPE = 'kanban';

interface KanbanDestination {
	columnName?: string | null;
	columnIndex?: number | null;
}

interface KanbanLaneContext {
	element: Element | null;
	destination: KanbanDestination;
}

export default class MasterBoard extends Plugin {
	settings: MasterBoardSettings;
	private pendingAutoSyncs = new Map<string, ReturnType<typeof setTimeout>>();
	private runningAutoSyncs = new Set<string>();
	private kanbanButtonObserver: MutationObserver | null = null;
	private kanbanButtonRefresh: ReturnType<typeof requestAnimationFrame> | null = null;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new MasterBoardSettingTab(this.app, this));
		this.registerAutoSync();
		this.registerKanbanBoardCardButtons();
		this.addRibbonIcon('layout-list', 'Create linked child board', () => {
			this.openCreateBoardModal();
		});

		this.addCommand({
			id: 'create-linked-child-board',
			name: 'Create linked child board',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile)) {
					return false;
				}

				if (!checking) {
					this.openCreateBoardModal(file);
				}

				return true;
			},
		});

		this.addCommand({
			id: 'inspect-current-board-rollups',
			name: 'Inspect current board rollups',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile)) {
					return false;
				}

				if (!checking) {
					this.inspectCurrentBoard(file);
				}

				return true;
			},
		});

		this.addCommand({
			id: 'sync-current-board-rollups',
			name: 'Sync current board rollups',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile)) {
					return false;
				}

				if (!checking) {
					this.syncCurrentBoard(file);
				}

				return true;
			},
		});
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private openCreateBoardModal(
		file = this.app.workspace.getActiveFile(),
		destination: KanbanDestination = {},
		initialTitle = ''
	) {
		if (!(file instanceof TFile)) {
			new Notice('Open a parent board before creating a linked child board.');
			return;
		}

		if (!isBoardFile(this.app, file)) {
			new Notice('Open a Kanban board before creating a linked child board.');
			return;
		}

		new CreateLinkedBoardModal(this.app, async (title) => {
			try {
				const result = await createLinkedChildBoard(this.app, file, title, this.settings, {
					destinationColumn: destination.columnName,
					destinationColumnIndex: destination.columnIndex,
				});
				await this.openChildBoardFile(result.childFile);
				new Notice(`Created ${result.childFile.basename} and linked it from ${file.basename}.`);
			} catch (error) {
				console.error('Master Board create child board failed', error);
				new Notice(error instanceof Error ? error.message : 'Could not create linked child board.');
			}
		}, initialTitle).open();
	}

	private async createBoardCardFromKanbanButton(sourceEl: HTMLElement) {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || !isBoardFile(this.app, file)) {
			new Notice('Open a Kanban board before creating a board-card.');
			return;
		}

		const laneContext = getKanbanLaneContext(sourceEl);
		const editorTitle = getCardEditorText(laneContext.element);

		if (!editorTitle) {
			this.openCreateBoardModal(file, laneContext.destination);
			return;
		}

		try {
			const result = await createLinkedChildBoard(this.app, file, editorTitle, this.settings, {
				destinationColumn: laneContext.destination.columnName,
				destinationColumnIndex: laneContext.destination.columnIndex,
			});
			await this.openChildBoardFile(result.childFile);
			new Notice(`Created ${result.childFile.basename} and linked it from ${file.basename}.`);
		} catch (error) {
			console.error('Master Board create board-card failed', error);
			new Notice(error instanceof Error ? error.message : 'Could not create board-card.');
		}
	}

	private async openChildBoardFile(file: TFile) {
		const leaf = this.app.workspace.getLeaf(false);

		try {
			await leaf.setViewState({
				type: KANBAN_VIEW_TYPE,
				state: {
					file: file.path,
				},
			});
		} catch (error) {
			console.warn('Master Board could not open the child board in Kanban view.', error);
			await leaf.openFile(file);
		}
	}

	private async inspectCurrentBoard(file: TFile) {
		const inspection = await inspectBoard(this.app, file, this.settings);
		const proposedMoves = inspection.cards.filter((card) => card.wouldMove);

		console.group(`Master Board Kanban: ${inspection.boardPath}`);
		if (inspection.warnings.length > 0) {
			console.warn('Warnings', inspection.warnings);
		}
		console.table(inspection.cards.map((card) => ({
			card: card.cardText,
			child: card.childPath,
			childStatus: card.childStatus,
			currentColumn: card.currentColumn,
			destinationColumn: card.destinationColumn ?? '(no match)',
			wouldMove: card.wouldMove,
			progress: `${card.childDoneCount}/${card.childTotalCount}`,
		})));
		console.groupEnd();

		new Notice(
			`Master Board: ${proposedMoves.length} proposed moves for ${inspection.cards.length} board cards.`
		);
	}

	private async syncCurrentBoard(file: TFile) {
		const result = await syncBoard(this.app, file, this.settings);

		if (!result.enabled) {
			new Notice('Master Board sync is disabled for this board.');
			return;
		}

		if (result.movedCount === 0) {
			new Notice(`Master Board: no cards needed to move (${result.cards.length} board cards checked).`);
			return;
		}

		new Notice(`Master Board: moved ${result.movedCount} board card${result.movedCount === 1 ? '' : 's'}.`);
	}

	private registerAutoSync() {
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile) {
				this.scheduleAffectedBoards(file);
			}
		}));

		this.registerEvent(this.app.workspace.on('file-open', (file) => {
			if (file instanceof TFile) {
				this.scheduleBoardSync(file);
			}
		}));

		this.app.workspace.onLayoutReady(() => {
			const file = this.app.workspace.getActiveFile();
			if (file instanceof TFile) {
				this.scheduleBoardSync(file);
			}
		});

		this.register(() => this.clearAutoSyncTimers());
	}

	private registerKanbanBoardCardButtons() {
		this.kanbanButtonObserver = new MutationObserver(() => this.scheduleKanbanButtonRefresh());
		this.kanbanButtonObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});

		this.register(() => {
			this.kanbanButtonObserver?.disconnect();
			this.kanbanButtonObserver = null;
			if (this.kanbanButtonRefresh) {
				cancelAnimationFrame(this.kanbanButtonRefresh);
				this.kanbanButtonRefresh = null;
			}
		});

		this.scheduleKanbanButtonRefresh();
	}

	private scheduleKanbanButtonRefresh() {
		if (this.kanbanButtonRefresh) {
			return;
		}

		this.kanbanButtonRefresh = requestAnimationFrame(() => {
			this.kanbanButtonRefresh = null;
			this.addKanbanBoardCardButtons();
		});
	}

	private addKanbanBoardCardButtons() {
		document
			.querySelectorAll<HTMLElement>('.kanban-plugin__new-item-button')
			.forEach((button) => this.addBoardCardButtonNearNewItemButton(button));

		document
			.querySelectorAll<HTMLElement>('.kanban-plugin__item-input-actions')
			.forEach((actions) => this.addBoardCardButtonToInputActions(actions));
	}

	private addBoardCardButtonNearNewItemButton(button: HTMLElement) {
		if (button.parentElement?.querySelector(':scope > .master-board-kanban-board-card-button')) {
			return;
		}

		const boardButton = this.buildBoardCardButton('Board card');
		button.insertAdjacentElement('afterend', boardButton);
	}

	private addBoardCardButtonToInputActions(actions: HTMLElement) {
		if (actions.querySelector(':scope > .master-board-kanban-board-card-button')) {
			return;
		}

		const boardButton = this.buildBoardCardButton('Create board-card from this title');
		actions.appendChild(boardButton);
	}

	private buildBoardCardButton(label: string): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.addClass('master-board-kanban-board-card-button');
		button.setAttr('aria-label', label);
		button.setAttr('title', label);
		setIcon(button, 'layout-list');
		button.createSpan({ text: 'Board' });

		this.registerDomEvent(button, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.createBoardCardFromKanbanButton(button);
		});

		return button;
	}

	private scheduleAffectedBoards(file: TFile) {
		if (!this.settings.automation.enabled || file.extension !== 'md') {
			return;
		}

		const boards = new Map<string, TFile>();
		if (isBoardFile(this.app, file)) {
			boards.set(file.path, file);
		}

		for (const parent of findParentBoards(this.app, file)) {
			boards.set(parent.path, parent);
		}

		for (const board of boards.values()) {
			this.scheduleBoardSync(board);
		}
	}

	private scheduleBoardSync(file: TFile) {
		if (!this.settings.automation.enabled || !isBoardFile(this.app, file)) {
			return;
		}

		const existingTimer = this.pendingAutoSyncs.get(file.path);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			this.pendingAutoSyncs.delete(file.path);
			this.runAutoSync(file);
		}, this.settings.automation.debounceMs);

		this.pendingAutoSyncs.set(file.path, timer);
	}

	private async runAutoSync(file: TFile) {
		if (this.runningAutoSyncs.has(file.path)) {
			return;
		}

		this.runningAutoSyncs.add(file.path);
		try {
			const result = await syncBoard(this.app, file, this.settings);
			if (result.movedCount > 0 && this.settings.automation.showNotices) {
				new Notice(
					`Master Board: auto-moved ${result.movedCount} card${result.movedCount === 1 ? '' : 's'} in ${file.basename}.`
				);
			}
		} catch (error) {
			console.error('Master Board auto sync failed', error);
			new Notice(`Master Board: auto sync failed for ${file.basename}.`);
		} finally {
			this.runningAutoSyncs.delete(file.path);
		}
	}

	private clearAutoSyncTimers() {
		for (const timer of this.pendingAutoSyncs.values()) {
			clearTimeout(timer);
		}

		this.pendingAutoSyncs.clear();
	}
}

function getCardEditorText(scope: Element | null): string {
	const editor = scope?.querySelector('.kanban-plugin__item-input-wrapper .cm-content');
	return editor?.textContent?.trim() ?? '';
}

function getKanbanLaneContext(sourceEl: Element): KanbanLaneContext {
	const lane = getKanbanLane(sourceEl);

	return {
		element: lane,
		destination: {
			columnName: getKanbanLaneTitle(lane),
			columnIndex: getKanbanLaneIndex(lane),
		},
	};
}

function getKanbanLane(sourceEl: Element): Element | null {
	const lane = sourceEl.closest('.kanban-plugin__lane');
	if (lane) {
		return lane;
	}

	return sourceEl.closest('.kanban-plugin__lane-wrapper')?.querySelector('.kanban-plugin__lane') ?? null;
}

function getKanbanLaneTitle(lane: Element | null): string | null {
	const title = lane?.querySelector('.kanban-plugin__lane-title-text')?.textContent?.trim();
	return title || null;
}

function getKanbanLaneIndex(lane: Element | null): number | null {
	const laneWrapper = lane?.closest('.kanban-plugin__lane-wrapper');
	if (laneWrapper?.parentElement) {
		const laneWrappers = Array.from(
			laneWrapper.parentElement.querySelectorAll(':scope > .kanban-plugin__lane-wrapper')
		);
		const laneWrapperIndex = laneWrappers.indexOf(laneWrapper);
		if (laneWrapperIndex >= 0) {
			return laneWrapperIndex;
		}
	}

	if (lane?.parentElement) {
		const siblingLanes = Array.from(lane.parentElement.querySelectorAll(':scope > .kanban-plugin__lane'));
		const laneIndex = siblingLanes.indexOf(lane);
		if (laneIndex >= 0) {
			return laneIndex;
		}
	}

	const board = lane?.closest('.kanban-plugin');
	if (board && lane) {
		const boardLanes = Array.from(board.querySelectorAll('.kanban-plugin__lane'));
		const boardLaneIndex = boardLanes.indexOf(lane);
		if (boardLaneIndex >= 0) {
			return boardLaneIndex;
		}
	}

	return null;
}

class CreateLinkedBoardModal extends Modal {
	private titleValue = '';
	private isSubmitted = false;
	private onSubmit: (title: string) => void | Promise<void>;

	constructor(app: App, onSubmit: (title: string) => void | Promise<void>, initialTitle = '') {
		super(app);
		this.onSubmit = onSubmit;
		this.titleValue = initialTitle;
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.empty();
		contentEl.createEl('h2', { text: 'Create Linked Child Board' });

		new Setting(contentEl)
			.setName('Board name')
			.addText((text) => {
				text
					.setPlaceholder('New board')
					.setValue(this.titleValue)
					.onChange((value) => {
						this.titleValue = value;
					});

				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' && !event.isComposing) {
						event.preventDefault();
						event.stopPropagation();
						this.submit();
					}
				});

				window.setTimeout(() => text.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText('Create board')
				.setCta()
				.onClick(() => this.submit()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit() {
		if (this.isSubmitted) {
			return;
		}

		const title = this.titleValue.trim();
		if (!title) {
			new Notice('Enter a board name first.');
			return;
		}

		this.isSubmitted = true;
		this.close();
		void this.onSubmit(title);
	}
}

class MasterBoardSettingTab extends PluginSettingTab {
	plugin: MasterBoard;

	constructor(app: App, plugin: MasterBoard) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl('h2', { text: 'Master Board Kanban' });
		containerEl.createEl('p', {
			text: 'Map your Kanban list names to rollup statuses. Board frontmatter can override these defaults per board.',
		});

		new Setting(containerEl)
			.setName('Automatic sync')
			.setDesc('Automatically sync changed boards and parent boards that link to them.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.automation.enabled)
				.onChange(async (value) => {
					this.plugin.settings.automation.enabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Automatic sync delay')
			.setDesc('Milliseconds to wait after a file changes before syncing.')
			.addText((text) => text
				.setPlaceholder(String(DEFAULT_SETTINGS.automation.debounceMs))
				.setValue(String(this.plugin.settings.automation.debounceMs))
				.onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isNaN(parsed) && parsed >= 250 && parsed <= 10000) {
						this.plugin.settings.automation.debounceMs = Math.round(parsed);
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Show automatic sync notices')
			.setDesc('Show a small notice when automatic sync moves cards.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.automation.showNotices)
				.onChange(async (value) => {
					this.plugin.settings.automation.showNotices = value;
					await this.plugin.saveSettings();
				}));

		for (const status of STATUS_KEYS) {
			this.addAliasSetting(containerEl, status);
		}

		new Setting(containerEl)
			.setName('Nearly done threshold')
			.setDesc('Done ratio needed before a child board rolls up as nearly done.')
			.addText((text) => text
				.setPlaceholder(String(DEFAULT_SETTINGS.thresholds.nearlyDone))
				.setValue(String(this.plugin.settings.thresholds.nearlyDone))
				.onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
						this.plugin.settings.thresholds.nearlyDone = parsed;
						await this.plugin.saveSettings();
					}
				}));
	}

	private addAliasSetting(containerEl: HTMLElement, status: StatusKey) {
		new Setting(containerEl)
			.setName(`${status} columns`)
			.setDesc('Comma-separated or one per line.')
			.addTextArea((text) => {
				text
					.setValue(formatAliasInput(this.plugin.settings.columns[status]))
					.onChange(async (value) => {
						this.plugin.settings.columns[status] = parseAliasInput(value);
						await this.plugin.saveSettings();
					});

				text.inputEl.rows = 3;
				text.inputEl.addClass('master-board-settings-textarea');
			});
	}
}
