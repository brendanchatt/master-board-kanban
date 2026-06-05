import { App, TFile, getLinkpath } from 'obsidian';

import { KanbanCard, parseKanbanBoard } from './kanban';
import {
	MasterBoardConfig,
	MasterBoardSettings,
	StatusKey,
	buildBoardConfig,
	findDestinationColumn,
	findStatusForColumn,
} from './settings';

type StatusCounts = Record<StatusKey, number>;

export interface BoardInspection {
	boardPath: string;
	enabled: boolean;
	cards: CardInspection[];
	warnings: string[];
}

export interface CardInspection {
	cardText: string;
	cardLine: number;
	lineStart: number;
	lineEnd: number;
	currentColumn: string;
	childPath: string;
	childStatus: StatusKey;
	childTotalCount: number;
	childDoneCount: number;
	destinationColumn: string | null;
	wouldMove: boolean;
}

export interface BoardSyncResult extends BoardInspection {
	movedCount: number;
}

interface BoardRollup {
	filePath: string;
	status: StatusKey;
	totalCount: number;
	doneCount: number;
	counts: StatusCounts;
	warnings: string[];
}

export async function inspectBoard(
	app: App,
	file: TFile,
	settings: MasterBoardSettings
): Promise<BoardInspection> {
	const warnings: string[] = [];
	const parentConfig = getBoardConfig(app, file, settings);

	if (!parentConfig.enabled) {
		warnings.push(`${file.path} has master-board.enabled set to false.`);
	}

	const content = await app.vault.cachedRead(file);
	const board = parseKanbanBoard(content, file.path);
	const columnNames = board.columns.map((column) => column.heading);
	const cards: CardInspection[] = [];

	for (const column of board.columns) {
		for (const card of column.cards) {
			const child = resolveLinkedBoard(app, card, file.path);
			if (!child) {
				continue;
			}

			const childRollup = await computeBoardRollup(app, child, settings, new Set([file.path]));
			warnings.push(...childRollup.warnings);

			const destinationColumn = findDestinationColumn(columnNames, childRollup.status, parentConfig);
			cards.push({
				cardText: card.text,
				cardLine: card.lineStart + 1,
				lineStart: card.lineStart,
				lineEnd: card.lineEnd,
				currentColumn: column.heading,
				childPath: child.path,
				childStatus: childRollup.status,
				childTotalCount: childRollup.totalCount,
				childDoneCount: childRollup.doneCount,
				destinationColumn,
				wouldMove: Boolean(destinationColumn && destinationColumn !== column.heading),
			});
		}
	}

	return {
		boardPath: file.path,
		enabled: parentConfig.enabled,
		cards,
		warnings: uniqueStrings(warnings),
	};
}

export async function syncBoard(
	app: App,
	file: TFile,
	settings: MasterBoardSettings
): Promise<BoardSyncResult> {
	const inspection = await inspectBoard(app, file, settings);
	if (!inspection.enabled) {
		return {
			...inspection,
			movedCount: 0,
		};
	}

	const moves = inspection.cards.filter((card) => card.wouldMove && card.destinationColumn);
	if (moves.length === 0) {
		return {
			...inspection,
			movedCount: 0,
		};
	}

	const content = await app.vault.cachedRead(file);
	const updatedContent = moveCards(content, moves);
	if (updatedContent !== content) {
		await app.vault.modify(file, updatedContent);
	}

	return {
		...inspection,
		movedCount: updatedContent === content ? 0 : moves.length,
	};
}

export function isBoardFile(app: App, file: TFile): boolean {
	return file.extension === 'md' && isKanbanBoard(app, file);
}

export function findParentBoards(app: App, child: TFile): TFile[] {
	const parents: TFile[] = [];

	for (const candidate of app.vault.getMarkdownFiles()) {
		if (candidate.path === child.path || !isKanbanBoard(app, candidate)) {
			continue;
		}

		const cache = app.metadataCache.getFileCache(candidate);
		const links = [
			...(cache?.links ?? []),
			...(cache?.frontmatterLinks ?? []),
		];

		if (links.some((link) => app.metadataCache.getFirstLinkpathDest(
			getLinkpath(link.link),
			candidate.path
		)?.path === child.path)) {
			parents.push(candidate);
		}
	}

	return parents;
}

async function computeBoardRollup(
	app: App,
	file: TFile,
	settings: MasterBoardSettings,
	visited: Set<string>
): Promise<BoardRollup> {
	if (visited.has(file.path)) {
		return {
			filePath: file.path,
			status: 'active',
			totalCount: 0,
			doneCount: 0,
			counts: emptyCounts(),
			warnings: [`Circular board reference detected at ${file.path}. Treating it as active.`],
		};
	}

	const nextVisited = new Set(visited);
	nextVisited.add(file.path);

	const config = getBoardConfig(app, file, settings);
	const content = await app.vault.cachedRead(file);
	const board = parseKanbanBoard(content, file.path);
	const counts = emptyCounts();
	const warnings: string[] = [];

	for (const column of board.columns) {
		for (const card of column.cards) {
			const child = resolveLinkedBoard(app, card, file.path);
			let status = findStatusForColumn(column.heading, config) ?? 'todo';

			if (child) {
				const childRollup = await computeBoardRollup(app, child, settings, nextVisited);
				status = childRollup.status;
				warnings.push(...childRollup.warnings);
			}

			counts[status] += 1;
		}
	}

	const totalCount = sumCounts(counts);
	const doneCount = counts.done;

	return {
		filePath: file.path,
		status: deriveBoardStatus(counts, config),
		totalCount,
		doneCount,
		counts,
		warnings,
	};
}

function deriveBoardStatus(counts: StatusCounts, config: MasterBoardConfig): StatusKey {
	const totalCount = sumCounts(counts);

	if (totalCount === 0) {
		return 'todo';
	}

	if (counts.done === totalCount) {
		return 'done';
	}

	if (counts.done / totalCount >= config.thresholds.nearlyDone) {
		return 'nearlyDone';
	}

	if (counts.active > 0 || counts.nearlyDone > 0 || counts.done > 0) {
		return 'active';
	}

	if (counts.todo > 0) {
		return 'todo';
	}

	if (counts.parked > 0) {
		return 'parked';
	}

	return 'todo';
}

function getBoardConfig(app: App, file: TFile, settings: MasterBoardSettings): MasterBoardConfig {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	return buildBoardConfig(settings, frontmatter?.['master-board']);
}

function resolveLinkedBoard(app: App, card: KanbanCard, sourcePath: string): TFile | null {
	for (const link of card.links) {
		const linkPath = getLinkpath(link);
		const destination = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);

		if (destination instanceof TFile && isKanbanBoard(app, destination)) {
			return destination;
		}
	}

	return null;
}

function isKanbanBoard(app: App, file: TFile): boolean {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	return frontmatter?.['kanban-plugin'] === 'board';
}

function emptyCounts(): StatusCounts {
	return {
		parked: 0,
		todo: 0,
		active: 0,
		nearlyDone: 0,
		done: 0,
	};
}

function sumCounts(counts: StatusCounts): number {
	return counts.parked + counts.todo + counts.active + counts.nearlyDone + counts.done;
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}

function moveCards(content: string, moves: CardInspection[]): string {
	const lines = content.split(/\r?\n/);
	const finalNewline = content.endsWith('\n');
	const sortedMoves = [...moves].sort((a, b) => b.lineStart - a.lineStart);
	const blocksByDestination = new Map<string, string[][]>();

	for (const move of sortedMoves) {
		const destination = move.destinationColumn;
		if (!destination) {
			continue;
		}

		const block = lines.slice(move.lineStart, move.lineEnd + 1);
		lines.splice(move.lineStart, move.lineEnd - move.lineStart + 1);

		const existingBlocks = blocksByDestination.get(destination) ?? [];
		existingBlocks.unshift(block);
		blocksByDestination.set(destination, existingBlocks);
	}

	for (const [destination, blocks] of blocksByDestination) {
		const insertAt = findColumnInsertionIndex(lines, destination);
		if (insertAt === null) {
			continue;
		}

		lines.splice(insertAt, 0, ...buildInsertion(lines, insertAt, blocks));
	}

	const updated = lines.join('\n');
	if (finalNewline || updated.endsWith('\n')) {
		return updated;
	}

	return `${updated}\n`;
}

function findColumnInsertionIndex(lines: string[], destination: string): number | null {
	const headingLine = lines.findIndex((line) => {
		const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
		return heading?.[2].trim() === destination;
	});

	if (headingLine === -1) {
		return null;
	}

	let insertAt = lines.length;
	for (let lineIndex = headingLine + 1; lineIndex < lines.length; lineIndex++) {
		if (isColumnBoundary(lines[lineIndex])) {
			insertAt = lineIndex;
			break;
		}
	}

	while (insertAt > headingLine + 1 && lines[insertAt - 1].trim() === '') {
		insertAt--;
	}

	return insertAt;
}

function buildInsertion(lines: string[], insertAt: number, blocks: string[][]): string[] {
	const insertion: string[] = [];
	const previousLine = lines[insertAt - 1] ?? '';
	const nextLine = lines[insertAt] ?? '';

	if (isHeading(previousLine)) {
		insertion.push('');
	}

	for (const block of blocks) {
		insertion.push(...block);
	}

	if (nextLine.trim() !== '') {
		insertion.push('');
	}

	return insertion;
}

function isColumnBoundary(line: string): boolean {
	return isHeading(line) || line.trim() === '%% kanban:settings';
}

function isHeading(line: string): boolean {
	return /^(#{2,6})\s+(.+?)\s*$/.test(line);
}
