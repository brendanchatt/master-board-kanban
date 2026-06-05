import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

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

export default class MasterBoard extends Plugin {
	settings: MasterBoardSettings;
	private pendingAutoSyncs = new Map<string, ReturnType<typeof setTimeout>>();
	private runningAutoSyncs = new Set<string>();

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new MasterBoardSettingTab(this.app, this));
		this.registerAutoSync();

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
