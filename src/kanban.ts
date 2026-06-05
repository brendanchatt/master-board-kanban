export interface KanbanBoard {
	filePath: string;
	columns: KanbanColumn[];
}

export interface KanbanColumn {
	heading: string;
	line: number;
	cards: KanbanCard[];
}

export interface KanbanCard {
	text: string;
	checked: boolean;
	column: string;
	lineStart: number;
	lineEnd: number;
	rawLines: string[];
	links: string[];
}

interface DraftCard {
	text: string;
	checked: boolean;
	lineStart: number;
	links: string[];
}

export function parseKanbanBoard(content: string, filePath: string): KanbanBoard {
	const lines = content.split(/\r?\n/);
	const columns: KanbanColumn[] = [];
	let currentColumn: KanbanColumn | null = null;
	let activeCard: DraftCard | null = null;

	const finishCard = (exclusiveEndLine: number) => {
		if (!activeCard || !currentColumn) {
			activeCard = null;
			return;
		}

		let cardEndLine = exclusiveEndLine;
		while (cardEndLine > activeCard.lineStart + 1 && lines[cardEndLine - 1].trim() === '') {
			cardEndLine--;
		}

		currentColumn.cards.push({
			text: activeCard.text,
			checked: activeCard.checked,
			column: currentColumn.heading,
			lineStart: activeCard.lineStart,
			lineEnd: cardEndLine - 1,
			rawLines: lines.slice(activeCard.lineStart, cardEndLine),
			links: activeCard.links,
		});

		activeCard = null;
	};

	for (let lineIndex = findContentStart(lines); lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		if (line.trim() === '%% kanban:settings') {
			finishCard(lineIndex);
			break;
		}

		const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);

		if (heading) {
			finishCard(lineIndex);
			currentColumn = {
				heading: heading[2].trim(),
				line: lineIndex,
				cards: [],
			};
			columns.push(currentColumn);
			continue;
		}

		if (!currentColumn) {
			continue;
		}

		const card = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s?(.*)$/);
		if (!card || card[1].length > 0) {
			continue;
		}

		finishCard(lineIndex);
		activeCard = {
			text: card[3].trim(),
			checked: card[2].toLowerCase() === 'x',
			lineStart: lineIndex,
			links: extractWikiLinks(card[3]),
		};
	}

	finishCard(lines.length);

	return {
		filePath,
		columns,
	};
}

export function extractWikiLinks(value: string): string[] {
	const links: string[] = [];
	const wikiLink = /\[\[([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;

	while ((match = wikiLink.exec(value)) !== null) {
		const target = match[1].split('|')[0].split('#')[0].trim();
		if (target) {
			links.push(target);
		}
	}

	return links;
}

function findContentStart(lines: string[]): number {
	if (lines[0]?.trim() !== '---') {
		return 0;
	}

	for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
		if (lines[lineIndex].trim() === '---') {
			return lineIndex + 1;
		}
	}

	return 0;
}
