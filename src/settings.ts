export const STATUS_KEYS = ['parked', 'todo', 'active', 'nearlyDone', 'done'] as const;

export type StatusKey = typeof STATUS_KEYS[number];

export type ColumnAliases = Record<StatusKey, string[]>;

export interface MasterBoardSettings {
	automation: {
		enabled: boolean;
		debounceMs: number;
		showNotices: boolean;
	};
	columns: ColumnAliases;
	thresholds: {
		nearlyDone: number;
		done: number;
	};
}

export interface MasterBoardConfig extends MasterBoardSettings {
	enabled: boolean;
}

export const DEFAULT_SETTINGS: MasterBoardSettings = {
	automation: {
		enabled: true,
		debounceMs: 1200,
		showNotices: true,
	},
	columns: {
		parked: ['back burner', 'future', 'thoughts'],
		todo: ['todo', 'to do', 'tasks', 'issue', 'issues', 'stuff'],
		active: ['doing', 'in progress', 'current', 'started', 'workin on it', 'just started'],
		nearlyDone: ['just about done', 'i think this is done'],
		done: ['done', 'completed', 'resolved'],
	},
	thresholds: {
		nearlyDone: 0.75,
		done: 1,
	},
};

const DESTINATION_FALLBACKS: Record<StatusKey, StatusKey[]> = {
	parked: ['parked', 'todo'],
	todo: ['todo', 'parked'],
	active: ['active', 'todo'],
	nearlyDone: ['nearlyDone', 'active', 'done'],
	done: ['done'],
};

export function normalizeSettings(raw: unknown): MasterBoardSettings {
	const source = isRecord(raw) ? raw : {};
	const sourceAutomation = isRecord(source.automation) ? source.automation : {};
	const sourceColumns = isRecord(source.columns) ? source.columns : {};
	const sourceThresholds = isRecord(source.thresholds) ? source.thresholds : {};
	const columns = cloneColumns(DEFAULT_SETTINGS.columns);

	for (const status of STATUS_KEYS) {
		columns[status] = sanitizeAliases(sourceColumns[status], DEFAULT_SETTINGS.columns[status]);
	}

	return {
		automation: {
			enabled: typeof sourceAutomation.enabled === 'boolean'
				? sourceAutomation.enabled
				: DEFAULT_SETTINGS.automation.enabled,
			debounceMs: sanitizeDebounce(sourceAutomation.debounceMs, DEFAULT_SETTINGS.automation.debounceMs),
			showNotices: typeof sourceAutomation.showNotices === 'boolean'
				? sourceAutomation.showNotices
				: DEFAULT_SETTINGS.automation.showNotices,
		},
		columns,
		thresholds: {
			nearlyDone: sanitizeThreshold(sourceThresholds.nearlyDone, DEFAULT_SETTINGS.thresholds.nearlyDone),
			done: sanitizeThreshold(sourceThresholds.done, DEFAULT_SETTINGS.thresholds.done),
		},
	};
}

export function buildBoardConfig(settings: MasterBoardSettings, rawOverride: unknown): MasterBoardConfig {
	const config: MasterBoardConfig = {
		enabled: true,
		automation: { ...settings.automation },
		columns: cloneColumns(settings.columns),
		thresholds: { ...settings.thresholds },
	};

	if (!isRecord(rawOverride)) {
		return config;
	}

	if (typeof rawOverride.enabled === 'boolean') {
		config.enabled = rawOverride.enabled;
	}

	if (isRecord(rawOverride.columns)) {
		for (const status of STATUS_KEYS) {
			if (Object.prototype.hasOwnProperty.call(rawOverride.columns, status)) {
				config.columns[status] = sanitizeAliases(rawOverride.columns[status], config.columns[status]);
			}
		}
	}

	if (isRecord(rawOverride.thresholds)) {
		config.thresholds.nearlyDone = sanitizeThreshold(
			rawOverride.thresholds.nearlyDone,
			config.thresholds.nearlyDone
		);
		config.thresholds.done = sanitizeThreshold(rawOverride.thresholds.done, config.thresholds.done);
	}

	return config;
}

export function parseAliasInput(input: string): string[] {
	return input
		.split(/[\n,]/)
		.map((alias) => alias.trim())
		.filter(Boolean);
}

export function formatAliasInput(values: string[]): string {
	return values.join('\n');
}

export function findStatusForColumn(columnName: string, config: MasterBoardConfig): StatusKey | null {
	for (const status of STATUS_KEYS) {
		if (config.columns[status].some((alias) => columnMatchesAlias(columnName, alias))) {
			return status;
		}
	}

	return null;
}

export function findDestinationColumn(
	columnNames: string[],
	status: StatusKey,
	config: MasterBoardConfig
): string | null {
	for (const fallbackStatus of DESTINATION_FALLBACKS[status]) {
		const destination = columnNames.find((columnName) => findStatusForColumn(columnName, {
			...config,
			columns: {
				...config.columns,
				[fallbackStatus]: config.columns[fallbackStatus],
			},
		}) === fallbackStatus);

		if (destination) {
			return destination;
		}
	}

	return null;
}

export function normalizeColumnName(value: string): string {
	return value
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.replace(/\([^)]*\)/g, ' ')
		.replace(/[`*_~]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function columnMatchesAlias(columnName: string, alias: string): boolean {
	const normalizedColumn = normalizeColumnName(columnName);
	const normalizedAlias = normalizeColumnName(alias);

	if (!normalizedAlias) {
		return false;
	}

	return normalizedColumn === normalizedAlias
		|| compactName(normalizedColumn) === compactName(normalizedAlias)
		|| normalizedColumn.startsWith(`${normalizedAlias} `);
}

function compactName(value: string): string {
	return value.replace(/\s+/g, '');
}

function cloneColumns(columns: ColumnAliases): ColumnAliases {
	return {
		parked: [...columns.parked],
		todo: [...columns.todo],
		active: [...columns.active],
		nearlyDone: [...columns.nearlyDone],
		done: [...columns.done],
	};
}

function sanitizeAliases(value: unknown, fallback: string[]): string[] {
	const aliases = Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
		: typeof value === 'string'
			? parseAliasInput(value)
			: [];

	return aliases.length > 0 ? aliases : [...fallback];
}

function sanitizeThreshold(value: unknown, fallback: number): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string'
			? parseThresholdString(value)
			: NaN;

	if (Number.isNaN(parsed)) {
		return fallback;
	}

	if (parsed > 1 && parsed <= 100) {
		return parsed / 100;
	}

	return Math.max(0, Math.min(1, parsed));
}

function sanitizeDebounce(value: unknown, fallback: number): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string'
			? Number(value)
			: NaN;

	if (Number.isNaN(parsed)) {
		return fallback;
	}

	return Math.max(250, Math.min(10000, Math.round(parsed)));
}

function parseThresholdString(value: string): number {
	const trimmed = value.trim();
	const numberPart = trimmed.endsWith('%') ? trimmed.slice(0, -1) : trimmed;
	const parsed = Number(numberPart);

	return trimmed.endsWith('%') ? parsed / 100 : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
