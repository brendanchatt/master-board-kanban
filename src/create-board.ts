import { App, TFile, normalizePath } from 'obsidian';

import { parseKanbanBoard } from './kanban';
import {
	MasterBoardSettings,
	StatusKey,
	buildBoardConfig,
	findDestinationColumn,
	findStatusForColumn,
} from './settings';

export interface CreateLinkedBoardResult {
	childFile: TFile;
	insertedIntoColumn: string | null;
}

export interface CreateLinkedBoardOptions {
	destinationColumn?: string | null;
}

const CHILD_BOARD_STATUS_ORDER: StatusKey[] = ['todo', 'active', 'nearlyDone', 'done'];
const FALLBACK_CHILD_COLUMNS = ['To do', 'In progress', 'Completed'];

export async function createLinkedChildBoard(
	app: App,
	parentFile: TFile,
	rawTitle: string,
	settings: MasterBoardSettings,
	options: CreateLinkedBoardOptions = {}
): Promise<CreateLinkedBoardResult> {
	const title = rawTitle.trim();
	if (!title) {
		throw new Error('Board name is required.');
	}

	const parentContent = await app.vault.cachedRead(parentFile);
	const parentBoard = parseKanbanBoard(parentContent, parentFile.path);
	const parentColumnNames = parentBoard.columns.map((column) => column.heading);
	if (parentColumnNames.length === 0) {
		throw new Error('The current note does not look like a Kanban board.');
	}

	const parentConfig = buildBoardConfig(
		settings,
		app.metadataCache.getFileCache(parentFile)?.frontmatter?.['master-board']
	);
	const childPath = getUniqueMarkdownPath(app, parentFile, title);
	const childFile = await app.vault.create(
		childPath,
		buildChildBoardContent(title, getChildColumns(parentColumnNames, parentConfig))
	);

	const destinationColumn = options.destinationColumn && parentColumnNames.includes(options.destinationColumn)
		? options.destinationColumn
		: findDestinationColumn(parentColumnNames, 'todo', parentConfig)
		?? parentColumnNames[0]
		?? null;

	if (destinationColumn) {
		const updatedParent = insertCardIntoColumn(parentContent, destinationColumn, `- [ ] [[${childFile.basename}]]`);
		if (updatedParent !== parentContent) {
			await app.vault.modify(parentFile, updatedParent);
		}
	}

	return {
		childFile,
		insertedIntoColumn: destinationColumn,
	};
}

function getChildColumns(parentColumnNames: string[], parentConfig: ReturnType<typeof buildBoardConfig>): string[] {
	const columns: string[] = [];

	for (const status of CHILD_BOARD_STATUS_ORDER) {
		const matchingColumn = parentColumnNames.find((columnName) => findStatusForColumn(columnName, parentConfig) === status);
		if (matchingColumn) {
			columns.push(matchingColumn);
		}
	}

	return columns.length > 0 ? columns : FALLBACK_CHILD_COLUMNS;
}

function buildChildBoardContent(title: string, columns: string[]): string {
	const body = columns.map((column) => `## ${column}\n`).join('\n\n');

	return `---
kanban-plugin: board
tags:
  - master-board
---

# ${title}

${body}

%% kanban:settings
\`\`\`
{"kanban-plugin":"board","list-collapse":[${columns.map(() => 'false').join(',')}],"full-list-lane-width":true}
\`\`\`
%%
`;
}

function insertCardIntoColumn(content: string, destinationColumn: string, cardLine: string): string {
	const lines = content.split(/\r?\n/);
	const finalNewline = content.endsWith('\n');
	const insertAt = findColumnInsertionIndex(lines, destinationColumn);

	if (insertAt === null) {
		return content;
	}

	const insertion = buildCardInsertion(lines, insertAt, cardLine);
	lines.splice(insertAt, 0, ...insertion);

	const updated = lines.join('\n');
	return finalNewline || updated.endsWith('\n') ? updated : `${updated}\n`;
}

function findColumnInsertionIndex(lines: string[], destinationColumn: string): number | null {
	const headingLine = lines.findIndex((line) => {
		const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
		return heading?.[2].trim() === destinationColumn;
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

function buildCardInsertion(lines: string[], insertAt: number, cardLine: string): string[] {
	const insertion: string[] = [];
	const previousLine = lines[insertAt - 1] ?? '';
	const nextLine = lines[insertAt] ?? '';

	if (isHeading(previousLine)) {
		insertion.push('');
	}

	insertion.push(cardLine);

	if (nextLine.trim() !== '') {
		insertion.push('');
	}

	return insertion;
}

function getUniqueMarkdownPath(app: App, parentFile: TFile, title: string): string {
	const folder = parentFile.parent?.path === '/' ? '' : parentFile.parent?.path ?? '';
	const safeTitle = sanitizeFileName(title);
	let candidate = normalizePath(folder ? `${folder}/${safeTitle}.md` : `${safeTitle}.md`);
	let index = 2;

	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(folder ? `${folder}/${safeTitle} ${index}.md` : `${safeTitle} ${index}.md`);
		index += 1;
	}

	return candidate;
}

function sanitizeFileName(value: string): string {
	return value
		.replace(/[\\/#^[\]|]/g, '-')
		.replace(/\s+/g, ' ')
		.trim();
}

function isColumnBoundary(line: string): boolean {
	return isHeading(line) || line.trim() === '%% kanban:settings';
}

function isHeading(line: string): boolean {
	return /^(#{2,6})\s+(.+?)\s*$/.test(line);
}
