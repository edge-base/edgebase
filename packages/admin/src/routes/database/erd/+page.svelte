<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { base } from '$app/paths';
	import { schemaStore, type NamespaceDef, type TableDef } from '$lib/stores/schema';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { adminDashboardSchemaDocs } from '$lib/docs-links';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	interface TableField {
		name: string;
		type: string;
		pk?: boolean;
		fk?: string;
	}

	interface TableNode {
		name: string;
		databaseKey: string;
		fields: TableField[];
		x: number;
		y: number;
		height: number;
	}

	interface Relation {
		id: string;
		from: string;
		fromField: string;
		to: string;
		toField: string;
		fromDatabaseKey: string;
		toDatabaseKey: string;
	}

	interface DatabaseBlock {
		key: string;
		provider?: TableDef['provider'];
		dynamic?: boolean;
		color: string;
		tableCount: number;
		relationCount: number;
		internalRelationCount: number;
		crossRelationCount: number;
		x: number;
		y: number;
		width: number;
		height: number;
		empty: boolean;
	}

	interface BadgeSpec {
		label: string;
		fill: string;
		stroke: string;
		color: string;
	}

	interface BadgeLayout extends BadgeSpec {
		x: number;
		y: number;
		width: number;
	}

	interface RelationGeometry {
		d: string;
		startX: number;
		startY: number;
		endX: number;
		endY: number;
		labelX: number;
		labelY: number;
	}

	type RawField = {
		type?: string;
		references?: string | { table: string; column?: string };
	};

	type LayeredTable = {
		name: string;
		fields: TableField[];
		height: number;
	};

	type VisualColumn = {
		level: number;
		tables: LayeredTable[];
		height: number;
	};

	type BlockBadgeInput = {
		provider?: TableDef['provider'];
		dynamic?: boolean;
		color: string;
		tableCount: number;
		relationCount: number;
	};

	const TABLE_W = 300;
	const TABLE_HEADER_H = 42;
	const TABLE_FIELD_H = 26;
	const TABLE_RADIUS = 3;
	const TABLE_OPEN_W = 54;
	const TABLE_OPEN_H = 22;

	const BLOCK_HEADER_H = 56;
	const BLOCK_PADDING = 18;
	const BLOCK_LEVEL_GAP = 72;
	const BLOCK_LAYER_WRAP_GAP = 24;
	const BLOCK_TABLE_GAP_Y = 28;
	const BLOCK_GAP_Y = 40;
	const BLOCK_TOP_Y = 20;
	const BLOCK_SIDE_X = 24;
	const BLOCK_EMPTY_H = 88;
	const BLOCK_MAX_COLUMN_H = 900;
	const BLOCK_HEADER_TEXT_GAP = 20;
	const BLOCK_MIN_READABLE_W = 520;

	const VIEWPORT_BASE_W = 1220;
	const VIEWPORT_BASE_H = 760;
	const VIEWPORT_MIN_W = 980;
	const VIEWPORT_MIN_H = 680;
	const MIN_ZOOM = 0.6;
	const MAX_ZOOM = 2.25;
	const DEFAULT_ZOOM = 1.1;

	const PROVIDER_COLORS: Record<string, string> = {
		do: '#0f766e',
		d1: '#2563eb',
		postgres: '#c2410c',
		neon: '#c026d3',
	};

	let tables = $state<TableNode[]>([]);
	let relations = $state<Relation[]>([]);
	let databaseBlocks = $state<DatabaseBlock[]>([]);
	let canvas = $state({ w: VIEWPORT_BASE_W, h: VIEWPORT_BASE_H });
	let defaultViewBox = $state({ x: 0, y: 0, w: VIEWPORT_BASE_W, h: VIEWPORT_BASE_H });
	let viewBox = $state({ x: 0, y: 0, w: VIEWPORT_BASE_W, h: VIEWPORT_BASE_H });
	let zoom = $state(DEFAULT_ZOOM);
	let isPanning = $state(false);
	let panStart = $state({ x: 0, y: 0 });
	let containerEl: HTMLDivElement | null = $state(null);

	function withAlpha(hex: string, alpha: number): string {
		const normalized = hex.replace('#', '');
		if (normalized.length !== 6) {
			return `rgba(107, 114, 128, ${alpha})`;
		}

		const r = Number.parseInt(normalized.slice(0, 2), 16);
		const g = Number.parseInt(normalized.slice(2, 4), 16);
		const b = Number.parseInt(normalized.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function fallbackColor(key: string): string {
		const palette = ['#64748b', '#2563eb', '#0f766e', '#c2410c', '#c026d3', '#7c3aed'];
		let hash = 0;
		for (const char of key) {
			hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
		}
		return palette[hash % palette.length] ?? '#64748b';
	}

	function databaseColor(provider: TableDef['provider'], key: string): string {
		return provider ? (PROVIDER_COLORS[provider] ?? fallbackColor(key)) : fallbackColor(key);
	}

	function providerLabel(provider?: TableDef['provider']): string {
		if (provider === 'neon') return 'NEON';
		if (provider === 'postgres') return 'POSTGRES';
		if (provider === 'd1') return 'D1';
		if (provider === 'do') return 'DO';
		return 'UNKNOWN';
	}

	function topologyLabel(dynamic?: boolean): string {
		return dynamic ? 'Per-tenant DB' : 'Single DB';
	}

	function badgeWidth(label: string): number {
		return Math.max(60, label.length * 7 + 18);
	}

	function badgeTotalWidth(badges: BadgeSpec[]): number {
		return badges.reduce((sum, badge, index) => sum + badgeWidth(badge.label) + (index > 0 ? 8 : 0), 0);
	}

	function layoutBadges(badges: BadgeSpec[], startX: number, y: number): BadgeLayout[] {
		let cursor = startX;
		return badges.map((badge) => {
			const width = badgeWidth(badge.label);
			const nextBadge: BadgeLayout = { ...badge, x: cursor, y, width };
			cursor += width + 8;
			return nextBadge;
		});
	}

	function relationLabelWidth(label: string): number {
		return Math.max(44, label.length * 7 + 14);
	}

	function labelWidth(label: string, pxPerChar: number, minWidth = 0): number {
		return Math.max(minWidth, label.length * pxPerChar + 10);
	}

	function resolveReference(ref: RawField['references']) {
		if (!ref) return null;
		if (typeof ref === 'string') return { table: ref, column: 'id' };
		return {
			table: ref.table,
			column: ref.column ?? 'id',
		};
	}

	function buildFields(rawFields: Record<string, RawField>): TableField[] {
		const fields: TableField[] = [{ name: 'id', type: 'uuid', pk: true }];

		for (const [fieldName, fieldDef] of Object.entries(rawFields || {})) {
			const reference = resolveReference(fieldDef.references);
			fields.push({
				name: fieldName,
				type: fieldDef.type ?? 'text',
				fk: reference?.table,
			});
		}

		return fields;
	}

	function buildTableHeight(fields: TableField[]): number {
		return TABLE_HEADER_H + fields.length * TABLE_FIELD_H + 8;
	}

	function clampViewBox(box: { x: number; y: number; w: number; h: number }) {
		const width = Math.min(box.w, canvas.w);
		const height = Math.min(box.h, canvas.h);
		const maxX = Math.max(0, canvas.w - width);
		const maxY = Math.max(0, canvas.h - height);
		return {
			x: Math.min(Math.max(box.x, 0), maxX),
			y: Math.min(Math.max(box.y, 0), maxY),
			w: width,
			h: height,
		};
	}

	function applyZoom(nextZoom: number, origin?: { clientX: number; clientY: number }) {
		const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
		const nextW = defaultViewBox.w / clampedZoom;
		const nextH = defaultViewBox.h / clampedZoom;

		if (origin && containerEl) {
			const rect = containerEl.getBoundingClientRect();
			const focusRatioX = rect.width > 0 ? (origin.clientX - rect.left) / rect.width : 0.5;
			const focusRatioY = rect.height > 0 ? (origin.clientY - rect.top) / rect.height : 0.5;
			const focusX = viewBox.x + focusRatioX * viewBox.w;
			const focusY = viewBox.y + focusRatioY * viewBox.h;
			viewBox = clampViewBox({
				x: focusX - focusRatioX * nextW,
				y: focusY - focusRatioY * nextH,
				w: nextW,
				h: nextH,
			});
		} else {
			const centerX = viewBox.x + viewBox.w / 2;
			const centerY = viewBox.y + viewBox.h / 2;
			viewBox = clampViewBox({
				x: centerX - nextW / 2,
				y: centerY - nextH / 2,
				w: nextW,
				h: nextH,
			});
		}

		zoom = clampedZoom;
	}

	function computeViewportSize() {
		const width = containerEl?.clientWidth ? Math.max(VIEWPORT_MIN_W, containerEl.clientWidth) : VIEWPORT_BASE_W;
		const height = containerEl?.clientHeight ? Math.max(VIEWPORT_MIN_H, containerEl.clientHeight) : VIEWPORT_BASE_H;
		return {
			w: Math.min(canvas.w, width),
			h: Math.min(canvas.h, height),
		};
	}

	function syncViewport(resetPosition = false) {
		const nextFrame = computeViewportSize();
		defaultViewBox = {
			x: 0,
			y: 0,
			w: nextFrame.w,
			h: nextFrame.h,
		};

		if (resetPosition) {
			zoom = DEFAULT_ZOOM;
			viewBox = clampViewBox({
				x: 0,
				y: 0,
				w: nextFrame.w / DEFAULT_ZOOM,
				h: nextFrame.h / DEFAULT_ZOOM,
			});
			return;
		}

		const nextW = nextFrame.w / zoom;
		const nextH = nextFrame.h / zoom;
		const centerX = viewBox.x + viewBox.w / 2;
		const centerY = viewBox.y + viewBox.h / 2;
		viewBox = clampViewBox({
			x: centerX - nextW / 2,
			y: centerY - nextH / 2,
			w: nextW,
			h: nextH,
		});
	}

	function resetView() {
		syncViewport(true);
	}

	function focusBlock(blockKey: string) {
		const block = databaseBlocks.find((entry) => entry.key === blockKey);
		if (!block) return;
		const targetW = defaultViewBox.w / zoom;
		const targetH = defaultViewBox.h / zoom;
		viewBox = clampViewBox({
			x: Math.max(0, block.x - 24),
			y: Math.max(0, block.y - 24),
			w: targetW,
			h: targetH,
		});
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		const containerWidth = Math.max(containerEl?.clientWidth ?? 1, 1);
		const containerHeight = Math.max(containerEl?.clientHeight ?? 1, 1);
		const scaleX = viewBox.w / containerWidth;
		const scaleY = viewBox.h / containerHeight;

		let nextX = viewBox.x + event.deltaX * scaleX;
		let nextY = viewBox.y + event.deltaY * scaleY;

		if (event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
			nextX = viewBox.x + event.deltaY * scaleX;
			nextY = viewBox.y;
		}

		viewBox = clampViewBox({
			...viewBox,
			x: nextX,
			y: nextY,
		});
	}

	function onMouseDown(event: MouseEvent) {
		if (event.button !== 0) return;
		const target = event.target;
		if (
			target instanceof Element
			&& target.closest('a, button, input, textarea, select, [data-no-pan]')
		) {
			return;
		}
		isPanning = true;
		panStart = { x: event.clientX, y: event.clientY };
	}

	function onMouseMove(event: MouseEvent) {
		if (!isPanning) return;
		const dx = (event.clientX - panStart.x) * (viewBox.w / Math.max(containerEl?.clientWidth ?? 1, 1));
		const dy = (event.clientY - panStart.y) * (viewBox.h / Math.max(containerEl?.clientHeight ?? 1, 1));
		viewBox = clampViewBox({
			...viewBox,
			x: viewBox.x - dx,
			y: viewBox.y - dy,
		});
		panStart = { x: event.clientX, y: event.clientY };
	}

	function onMouseUp() {
		isPanning = false;
	}

	function deriveMetaFromTables(
		tableDefs: Array<[string, TableDef]>,
		stateNamespaces: Record<string, NamespaceDef>,
		key: string,
	): NamespaceDef {
		return stateNamespaces[key]
			?? {
				provider: tableDefs[0]?.[1].provider,
				dynamic: tableDefs[0]?.[1].dynamic,
				instanceDiscovery: tableDefs[0]?.[1].instanceDiscovery,
			};
	}

	function buildInternalReferenceMap(tableDefs: Array<[string, TableDef]>): Map<string, string[]> {
		const names = new Set(tableDefs.map(([name]) => name));
		const refs = new Map<string, string[]>();

		for (const [tableName, tableDef] of tableDefs) {
			const nextRefs: string[] = [];
			for (const fieldDef of Object.values(tableDef.fields || {})) {
				const reference = resolveReference(fieldDef.references as RawField['references']);
				if (reference && names.has(reference.table)) {
					nextRefs.push(reference.table);
				}
			}
			refs.set(tableName, nextRefs);
		}

		return refs;
	}

	function buildTableLevels(tableDefs: Array<[string, TableDef]>): Map<string, number> {
		const refs = buildInternalReferenceMap(tableDefs);
		const memo = new Map<string, number>();
		const visiting = new Set<string>();

		function visit(tableName: string): number {
			if (memo.has(tableName)) return memo.get(tableName)!;
			if (visiting.has(tableName)) return 0;

			visiting.add(tableName);
			let level = 0;
			for (const ref of refs.get(tableName) ?? []) {
				level = Math.max(level, visit(ref) + 1);
			}
			visiting.delete(tableName);
			memo.set(tableName, level);
			return level;
		}

		for (const [tableName] of tableDefs) {
			visit(tableName);
		}

		return memo;
	}

	function buildTableWeights(tableDefs: Array<[string, TableDef]>): Map<string, number> {
		const refs = buildInternalReferenceMap(tableDefs);
		const weights = new Map<string, number>();

		for (const [tableName] of tableDefs) {
			weights.set(tableName, 0);
		}

		for (const [tableName, targets] of refs) {
			weights.set(tableName, (weights.get(tableName) ?? 0) + targets.length);
			for (const target of targets) {
				weights.set(target, (weights.get(target) ?? 0) + 1);
			}
		}

		return weights;
	}

	function buildRelations(schema: Record<string, TableDef>): Relation[] {
		const relationsFromSchema: Relation[] = [];
		for (const [tableName, tableDef] of Object.entries(schema)) {
			for (const [fieldName, fieldDef] of Object.entries(tableDef.fields || {})) {
				const reference = resolveReference(fieldDef.references as RawField['references']);
				if (!reference) continue;

				relationsFromSchema.push({
					id: `${tableName}.${fieldName}->${reference.table}.${reference.column}`,
					from: tableName,
					fromField: fieldName,
					to: reference.table,
					toField: reference.column,
					fromDatabaseKey: tableDef.namespace || 'default',
					toDatabaseKey: schema[reference.table]?.namespace || 'default',
				});
			}
		}
		return relationsFromSchema;
	}

	function wrapLayerTables(layer: LayeredTable[], level: number): VisualColumn[] {
		const columns: VisualColumn[] = [];
		let currentTables: LayeredTable[] = [];
		let currentHeight = 0;

		for (const table of layer) {
			const nextHeight = currentTables.length === 0
				? table.height
				: currentHeight + BLOCK_TABLE_GAP_Y + table.height;

			if (currentTables.length > 0 && nextHeight > BLOCK_MAX_COLUMN_H) {
				columns.push({
					level,
					tables: currentTables,
					height: currentHeight,
				});
				currentTables = [table];
				currentHeight = table.height;
				continue;
			}

			currentTables.push(table);
			currentHeight = nextHeight;
		}

		if (currentTables.length > 0) {
			columns.push({
				level,
				tables: currentTables,
				height: currentHeight,
			});
		}

		return columns;
	}

	function databaseSortOrder(
		databaseKey: string,
		tablesByDatabase: Map<string, Array<[string, TableDef]>>,
		allRelations: Relation[],
	): [number, number, string] {
		const tableCount = tablesByDatabase.get(databaseKey)?.length ?? 0;
		const relationCount = allRelations.filter(
			(relation) => relation.fromDatabaseKey === databaseKey || relation.toDatabaseKey === databaseKey,
		).length;
		return [relationCount, tableCount, databaseKey];
	}

	function blockCopy(internalRelationCount: number, crossRelationCount: number): string {
		return `${internalRelationCount} internal relation${internalRelationCount === 1 ? '' : 's'}`
			+ (crossRelationCount > 0 ? ` · ${crossRelationCount} cross-db` : '');
	}

	function blockBadges(input: BlockBadgeInput): BadgeSpec[] {
		return [
			{
				label: providerLabel(input.provider),
				fill: withAlpha(input.color, 0.12),
				stroke: withAlpha(input.color, 0.28),
				color: input.color,
			},
			{
				label: topologyLabel(input.dynamic),
				fill: '#f8fafc',
				stroke: '#cbd5e1',
				color: '#475569',
			},
			{
				label: `${input.tableCount} table${input.tableCount === 1 ? '' : 's'}`,
				fill: '#f8fafc',
				stroke: '#cbd5e1',
				color: '#475569',
			},
			{
				label: `${input.relationCount} relation${input.relationCount === 1 ? '' : 's'}`,
				fill: '#f8fafc',
				stroke: '#cbd5e1',
				color: '#475569',
			},
		];
	}

	function blockMinWidth(key: string, badges: BadgeSpec[], copy: string): number {
		const titleWidth = labelWidth(key, 10, 110);
		const copyWidth = labelWidth(copy, 7, 210);
		const textWidth = Math.max(titleWidth, copyWidth);
		const headerWidth = BLOCK_PADDING * 2 + textWidth + BLOCK_HEADER_TEXT_GAP + badgeTotalWidth(badges);
		return Math.max(BLOCK_MIN_READABLE_W, headerWidth);
	}

	function getTableNode(name: string): TableNode | undefined {
		return tables.find((table) => table.name === name);
	}

	function getFieldY(table: TableNode, fieldName: string): number {
		const index = table.fields.findIndex((field) => field.name === fieldName);
		return table.y + TABLE_HEADER_H + (index >= 0 ? index : 0) * TABLE_FIELD_H + TABLE_FIELD_H / 2;
	}

	function relationGeometry(relation: Relation, index: number): RelationGeometry | null {
		const fromNode = getTableNode(relation.from);
		const toNode = getTableNode(relation.to);
		if (!fromNode || !toNode) return null;

		const startY = getFieldY(fromNode, relation.fromField);
		const endY = getFieldY(toNode, relation.toField);
		const laneOffset = 28 + (index % 5) * 10;

		if (toNode.x >= fromNode.x + TABLE_W) {
			const startX = fromNode.x + TABLE_W;
			const endX = toNode.x;
			const laneX = startX + (endX - startX) / 2;
			return {
				d: `M ${startX} ${startY} L ${laneX} ${startY} L ${laneX} ${endY} L ${endX} ${endY}`,
				startX,
				startY,
				endX,
				endY,
				labelX: laneX,
				labelY: (startY + endY) / 2,
			};
		}

		if (toNode.x + TABLE_W <= fromNode.x) {
			const startX = fromNode.x;
			const endX = toNode.x + TABLE_W;
			const laneX = endX + (startX - endX) / 2;
			return {
				d: `M ${startX} ${startY} L ${laneX} ${startY} L ${laneX} ${endY} L ${endX} ${endY}`,
				startX,
				startY,
				endX,
				endY,
				labelX: laneX,
				labelY: (startY + endY) / 2,
			};
		}

		const routeRight = relation.toDatabaseKey !== relation.fromDatabaseKey || toNode.y >= fromNode.y;
		const startX = routeRight ? fromNode.x + TABLE_W : fromNode.x;
		const endX = routeRight ? toNode.x + TABLE_W : toNode.x;
		const laneX = routeRight
			? Math.max(startX, endX) + laneOffset
			: Math.min(startX, endX) - laneOffset;

		return {
			d: `M ${startX} ${startY} L ${laneX} ${startY} L ${laneX} ${endY} L ${endX} ${endY}`,
			startX,
			startY,
			endX,
			endY,
			labelX: laneX,
			labelY: (startY + endY) / 2,
		};
	}

	onMount(() => {
		void schemaStore.loadSchema();

		const unsubscribe = schemaStore.subscribe((state) => {
			const tablesByDatabase = new Map<string, Array<[string, TableDef]>>();
			for (const [tableName, tableDef] of Object.entries(state.schema).sort(([a], [b]) => a.localeCompare(b))) {
				const databaseKey = tableDef.namespace || 'default';
				const entries = tablesByDatabase.get(databaseKey) ?? [];
				entries.push([tableName, tableDef]);
				tablesByDatabase.set(databaseKey, entries);
			}

			const allRelations = buildRelations(state.schema);
			const databaseKeys = Array.from(new Set([...Object.keys(state.namespaces), ...tablesByDatabase.keys()]))
				.sort((a, b) => {
					const [aRelations, aTables] = databaseSortOrder(a, tablesByDatabase, allRelations);
					const [bRelations, bTables] = databaseSortOrder(b, tablesByDatabase, allRelations);
					if (bRelations !== aRelations) return bRelations - aRelations;
					if (bTables !== aTables) return bTables - aTables;
					return a.localeCompare(b);
				});

			const nextTables: TableNode[] = [];
			const nextBlocks: DatabaseBlock[] = [];
			let cursorY = BLOCK_TOP_Y;
			let maxWidth = VIEWPORT_BASE_W;

			for (const databaseKey of databaseKeys) {
				const defs = tablesByDatabase.get(databaseKey) ?? [];
				const meta = deriveMetaFromTables(defs, state.namespaces, databaseKey);
				const color = databaseColor(meta.provider, databaseKey);
				const tableLevels = buildTableLevels(defs);
				const tableWeights = buildTableWeights(defs);
				const tableMap = new Map(defs);
				const columnCount = defs.length === 0 ? 1 : Math.max(...tableLevels.values(), 0) + 1;
				const layers = Array.from({ length: columnCount }, () => [] as LayeredTable[]);

				for (const [tableName] of defs) {
					const level = tableLevels.get(tableName) ?? 0;
					const tableDef = tableMap.get(tableName);
					if (!tableDef) continue;
					const fields = buildFields(tableDef.fields as Record<string, RawField>);
					layers[level].push({
						name: tableName,
						fields,
						height: buildTableHeight(fields),
					});
				}

				for (const layer of layers) {
					layer.sort((a, b) => {
						const weightDiff = (tableWeights.get(b.name) ?? 0) - (tableWeights.get(a.name) ?? 0);
						if (weightDiff !== 0) return weightDiff;
						return a.name.localeCompare(b.name);
					});
				}

				const visualColumns = layers.flatMap((layer, levelIndex) => wrapLayerTables(layer, levelIndex));
				const contentHeight = defs.length === 0
					? BLOCK_EMPTY_H
					: Math.max(...visualColumns.map((column) => column.height), 0);
				const visualColumnGap = visualColumns.reduce((sum, column, index) => {
					if (index === 0) return sum;
					const previous = visualColumns[index - 1];
					return sum + (previous?.level === column.level ? BLOCK_LAYER_WRAP_GAP : BLOCK_LEVEL_GAP);
				}, 0);

				const relationCount = allRelations.filter(
					(relation) => relation.fromDatabaseKey === databaseKey || relation.toDatabaseKey === databaseKey,
				).length;
				const internalRelationCount = allRelations.filter(
					(relation) => relation.fromDatabaseKey === databaseKey && relation.toDatabaseKey === databaseKey,
				).length;
				const crossRelationCount = relationCount - internalRelationCount;
				const badges = blockBadges({
					provider: meta.provider,
					dynamic: meta.dynamic,
					color,
					tableCount: defs.length,
					relationCount,
				});
				const copy = blockCopy(internalRelationCount, crossRelationCount);
				const contentWidth = defs.length === 0
					? TABLE_W
					: visualColumns.length * TABLE_W + visualColumnGap;
				const width = Math.max(
					BLOCK_PADDING * 2 + contentWidth,
					blockMinWidth(databaseKey, badges, copy),
				);
				const height = BLOCK_HEADER_H + BLOCK_PADDING * 2 + contentHeight;
				const blockX = BLOCK_SIDE_X;
				const blockY = cursorY;
				const contentInsetX = blockX + BLOCK_PADDING + Math.max(0, (width - BLOCK_PADDING * 2 - contentWidth) / 2);

				let xCursor = contentInsetX;
				for (const [columnIndex, column] of visualColumns.entries()) {
					let yCursor = blockY + BLOCK_HEADER_H + BLOCK_PADDING + (contentHeight - column.height) / 2;
					for (const table of column.tables) {
						nextTables.push({
							name: table.name,
							databaseKey,
							fields: table.fields,
							x: xCursor,
							y: yCursor,
							height: table.height,
						});
						yCursor += table.height + BLOCK_TABLE_GAP_Y;
					}

					const nextColumn = visualColumns[columnIndex + 1];
					if (!nextColumn) continue;
					xCursor += TABLE_W + (column.level === nextColumn.level ? BLOCK_LAYER_WRAP_GAP : BLOCK_LEVEL_GAP);
				}

				nextBlocks.push({
					key: databaseKey,
					provider: meta.provider,
					dynamic: meta.dynamic,
					color,
					tableCount: defs.length,
					relationCount,
					internalRelationCount,
					crossRelationCount,
					x: blockX,
					y: blockY,
					width,
					height,
					empty: defs.length === 0,
				});

				cursorY += height + BLOCK_GAP_Y;
				maxWidth = Math.max(maxWidth, width + BLOCK_SIDE_X * 2);
			}

			tables = nextTables;
			relations = allRelations;
			databaseBlocks = nextBlocks;
			canvas = {
				w: maxWidth,
				h: Math.max(cursorY, VIEWPORT_BASE_H),
			};
			void tick().then(() => {
				syncViewport(true);
			});
		});

		return unsubscribe;
	});

	$effect(() => {
		if (!containerEl || typeof window === 'undefined') return;
		const resizeObserver = typeof ResizeObserver !== 'undefined'
			? new ResizeObserver(() => {
				syncViewport(false);
			})
			: null;

		const handleMouseUp = () => onMouseUp();
		const handleMouseLeave = () => onMouseUp();

		containerEl.addEventListener('wheel', onWheel, { passive: false });
		containerEl.addEventListener('mousedown', onMouseDown);
		containerEl.addEventListener('mousemove', onMouseMove);
		containerEl.addEventListener('mouseleave', handleMouseLeave);
		window.addEventListener('mouseup', handleMouseUp);
		resizeObserver?.observe(containerEl);

		return () => {
			containerEl?.removeEventListener('wheel', onWheel);
			containerEl?.removeEventListener('mousedown', onMouseDown);
			containerEl?.removeEventListener('mousemove', onMouseMove);
			containerEl?.removeEventListener('mouseleave', handleMouseLeave);
			window.removeEventListener('mouseup', handleMouseUp);
			resizeObserver?.disconnect();
		};
	});
</script>

<PageShell
	title="Schema ERD"
	description="Database blocks come directly from edgebase.config.ts, including provider and single vs per-tenant topology."
	docsHref={adminDashboardSchemaDocs}
>
	{#if databaseBlocks.length === 0}
		<EmptyState title="No databases" description="Define database blocks in your config to see the ERD." />
	{:else}
		<div class="erd-toolbar">
			<div class="erd-counts">
				<span class="erd-count">{databaseBlocks.length} DB</span>
				<span class="erd-count">{tables.length} Tables</span>
				<span class="erd-count">{relations.length} Relations</span>
			</div>
			<div class="erd-legend">
				<span class="erd-legend__title">Providers</span>
				<span class="erd-legend__item"><span class="erd-legend__dot" style="background:#2563eb"></span>D1</span>
				<span class="erd-legend__item"><span class="erd-legend__dot" style="background:#0f766e"></span>DO</span>
				<span class="erd-legend__item"><span class="erd-legend__dot" style="background:#c2410c"></span>Postgres</span>
				<span class="erd-legend__item"><span class="erd-legend__dot" style="background:#c026d3"></span>Neon</span>
			</div>
		</div>

		<div class="erd-jumpbar">
			<span class="erd-jumpbar__title">Jump to DB</span>
			{#each databaseBlocks as block (block.key)}
				<button type="button" class="erd-jump" onclick={() => focusBlock(block.key)}>
					<span class="erd-jump__dot" style={`background:${block.color}`}></span>
					{block.key}
				</button>
			{/each}
		</div>

			<div
			bind:this={containerEl}
			class="erd-container"
			role="region"
			aria-label="Entity relationship diagram. Use the mouse wheel to scroll, drag to pan, and use the controls to zoom or reset the view."
		>
			<svg
				class="erd-svg"
				viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
				preserveAspectRatio="xMinYMin meet"
			>
				<rect x="0" y="0" width={canvas.w} height={canvas.h} fill="#f5f5f4" />

				{#each databaseBlocks as block (block.key)}
					{@const badges = blockBadges(block)}
					{@const copy = blockCopy(block.internalRelationCount, block.crossRelationCount)}
					{@const emptyCardX = block.x + (block.width - TABLE_W) / 2}
					{@const badgeLayouts = layoutBadges(
						badges,
						block.x + block.width - BLOCK_PADDING - badgeTotalWidth(badges),
						block.y + 15,
					)}

					<g>
						<rect
							x={block.x}
							y={block.y}
							width={block.width}
							height={block.height}
							rx="6"
							fill="#fbfbfa"
							stroke="#cfcfc9"
							stroke-width="1.4"
						/>
						<line
							x1={block.x}
							y1={block.y + BLOCK_HEADER_H}
							x2={block.x + block.width}
							y2={block.y + BLOCK_HEADER_H}
							stroke="#d8d8d4"
							stroke-width="1"
						/>
						<text x={block.x + 18} y={block.y + 25} class="erd-svg__block-title">{block.key}</text>
						<text x={block.x + 18} y={block.y + 43} class="erd-svg__block-copy">{copy}</text>

						{#each badgeLayouts as badge (badge.label)}
							<rect
								x={badge.x}
								y={badge.y}
								width={badge.width}
								height="24"
								rx="12"
								fill={badge.fill}
								stroke={badge.stroke}
								stroke-width="1"
							/>
							<text
								x={badge.x + badge.width / 2}
								y={badge.y + 16}
								class="erd-svg__badge"
								text-anchor="middle"
								fill={badge.color}
							>
								{badge.label}
							</text>
						{/each}

						{#if block.empty}
							<rect
								x={emptyCardX}
								y={block.y + BLOCK_HEADER_H + BLOCK_PADDING}
								width={TABLE_W}
								height={BLOCK_EMPTY_H}
								rx="4"
								fill="#ffffff"
								stroke="#d4d4d8"
								stroke-dasharray="5,4"
							/>
							<text x={emptyCardX + 16} y={block.y + BLOCK_HEADER_H + 50} class="erd-svg__empty-title">
								No tables yet
							</text>
							<text x={emptyCardX + 16} y={block.y + BLOCK_HEADER_H + 72} class="erd-svg__empty-copy">
								This database block exists in config, but there are no tables to draw.
							</text>
						{/if}
					</g>
				{/each}

				{#each relations as relation, index (relation.id)}
					{@const geometry = relationGeometry(relation, index)}
					{#if geometry}
						<path
							d={geometry.d}
							fill="none"
							stroke="#f8fafc"
							stroke-width={relation.fromDatabaseKey === relation.toDatabaseKey ? '5.6' : '5'}
							stroke-linecap="square"
							stroke-linejoin="miter"
						/>
						<path
							d={geometry.d}
							fill="none"
							stroke={relation.fromDatabaseKey === relation.toDatabaseKey ? '#52525b' : '#64748b'}
							stroke-width={relation.fromDatabaseKey === relation.toDatabaseKey ? '2.2' : '1.9'}
							stroke-linecap="square"
							stroke-linejoin="miter"
							stroke-dasharray={relation.fromDatabaseKey === relation.toDatabaseKey ? undefined : '7 5'}
						/>
						<circle cx={geometry.startX} cy={geometry.startY} r="2.6" fill="#44403c" />
						<circle cx={geometry.endX} cy={geometry.endY} r="2.6" fill="#44403c" />

						{#if zoom >= 0.95}
							{@const labelWidth = relationLabelWidth(relation.fromField)}
							<rect
								x={geometry.labelX - labelWidth / 2}
								y={geometry.labelY - 10}
								width={labelWidth}
								height="18"
								rx="3"
								fill="#ffffff"
								stroke="#d4d4d8"
								stroke-width="1"
							/>
							<text
								x={geometry.labelX}
								y={geometry.labelY + 2}
								class="erd-svg__relation-label"
								text-anchor="middle"
							>
								{relation.fromField}
							</text>
						{/if}
					{/if}
				{/each}

				{#each tables as table (table.name)}
					{@const block = databaseBlocks.find((entry) => entry.key === table.databaseKey)}
					{@const blockColor = block?.color ?? '#64748b'}
					{@const openX = table.x + TABLE_W - TABLE_OPEN_W - 12}
					{@const openY = table.y + 10}

					<g>
						<rect
							x={table.x}
							y={table.y}
							width={TABLE_W}
							height={table.height}
							rx={TABLE_RADIUS}
							fill="#ffffff"
							stroke="#585858"
							stroke-width="1.3"
						/>
						<rect
							x={table.x}
							y={table.y}
							width={TABLE_W}
							height={TABLE_HEADER_H}
							rx={TABLE_RADIUS}
							fill="#dddddd"
						/>
						<line x1={table.x} y1={table.y + TABLE_HEADER_H} x2={table.x + TABLE_W} y2={table.y + TABLE_HEADER_H} stroke="#585858" stroke-width="1.1" />
						<text x={table.x + 14} y={table.y + 26} class="erd-svg__table-title">{table.name}</text>
						<text x={table.x + 14} y={table.y + 39} class="erd-svg__table-meta">{table.databaseKey}</text>

						<a href={`${base}/database/tables/${table.name}`} aria-label={`Open table ${table.name}`}>
							<rect
								x={openX}
								y={openY}
								width={TABLE_OPEN_W}
								height={TABLE_OPEN_H}
								rx="3"
								fill="#ffffff"
								stroke={withAlpha(blockColor, 0.45)}
								stroke-width="1"
							/>
							<text x={openX + TABLE_OPEN_W / 2} y={openY + 15} class="erd-svg__open" text-anchor="middle">
								Open
							</text>
						</a>

						{#each table.fields as field, index}
							{@const rowY = table.y + TABLE_HEADER_H + index * TABLE_FIELD_H}
							{#if index > 0}
								<line
									x1={table.x}
									y1={rowY}
									x2={table.x + TABLE_W}
									y2={rowY}
									stroke="#d6d6d6"
									stroke-width="1"
								/>
							{/if}

							{#if field.pk}
								<text x={table.x + 12} y={rowY + 17} class="erd-svg__field-flag" fill="#111827">PK</text>
							{:else if field.fk}
								<text x={table.x + 12} y={rowY + 17} class="erd-svg__field-flag" fill={blockColor}>FK</text>
							{/if}

							<text
								x={table.x + (field.pk || field.fk ? 36 : 12)}
								y={rowY + 17}
								class="erd-svg__field-name"
								class:erd-svg__field-name--key={field.pk || field.fk}
							>
								{field.name}
							</text>
							<text
								x={table.x + TABLE_W - 12}
								y={rowY + 17}
								class="erd-svg__field-type"
								text-anchor="end"
							>
								{field.type}
							</text>
						{/each}
					</g>
				{/each}
			</svg>

			<div class="erd-controls">
				<button type="button" class="erd-control erd-control--wide" onclick={resetView}>Reset</button>
				<button type="button" class="erd-control" onclick={() => applyZoom(zoom * 1.12)}>+</button>
				<span class="erd-controls__zoom">{Math.round(zoom * 100)}%</span>
				<button type="button" class="erd-control" onclick={() => applyZoom(zoom / 1.12)}>-</button>
			</div>

			<div class="erd-hint">
				<span>Readable first</span>
				<span>Wheel to scroll</span>
				<span>Drag to pan</span>
				<span>Use the buttons to zoom</span>
			</div>
		</div>
	{/if}
</PageShell>

<style>
	.erd-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.erd-counts,
	.erd-legend,
	.erd-jumpbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.erd-jumpbar {
		margin-bottom: var(--space-3);
	}

	.erd-count {
		padding: 4px 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: #f8fafc;
		font-size: 12px;
		font-weight: 700;
		color: var(--color-text-secondary);
	}

	.erd-legend__title,
	.erd-jumpbar__title {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.erd-legend__item,
	.erd-jump {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: #f8fafc;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.erd-jump {
		cursor: pointer;
		font-family: inherit;
	}

	.erd-jump:hover {
		background: #f1f5f9;
		color: var(--color-text);
	}

	.erd-legend__dot,
	.erd-jump__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.erd-container {
		position: relative;
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius-md) + 2px);
		background: #f5f5f4;
		overflow: hidden;
		min-height: 760px;
		cursor: grab;
		user-select: none;
	}

	.erd-container:active {
		cursor: grabbing;
	}

	.erd-svg {
		display: block;
		width: 100%;
		height: 760px;
	}

	.erd-controls {
		position: absolute;
		top: var(--space-3);
		right: var(--space-3);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px;
		background: rgba(255, 255, 255, 0.92);
		border: 1px solid rgba(148, 163, 184, 0.24);
		border-radius: 12px;
		box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
	}

	.erd-control {
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: #ffffff;
		font-size: 16px;
		font-weight: 700;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.erd-control--wide {
		width: auto;
		padding: 0 12px;
		font-size: 13px;
	}

	.erd-control:hover {
		background: #f8fafc;
		color: var(--color-text);
	}

	.erd-controls__zoom {
		min-width: 46px;
		font-size: 12px;
		font-weight: 700;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.erd-hint {
		position: absolute;
		left: var(--space-3);
		bottom: var(--space-3);
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 10px;
		background: rgba(255, 255, 255, 0.94);
		border: 1px solid rgba(148, 163, 184, 0.24);
		border-radius: 12px;
		box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.erd-svg__block-title {
		font-size: 18px;
		font-weight: 700;
		fill: #18181b;
	}

	.erd-svg__block-copy {
		font-size: 12px;
		font-weight: 500;
		fill: #71717a;
	}

	.erd-svg__badge {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.erd-svg__empty-title {
		font-size: 14px;
		font-weight: 700;
		fill: #18181b;
	}

	.erd-svg__empty-copy {
		font-size: 12px;
		fill: #71717a;
	}

	.erd-svg__table-title {
		font-size: 14px;
		font-weight: 700;
		fill: #18181b;
	}

	.erd-svg__table-meta {
		font-size: 10px;
		font-weight: 600;
		fill: #71717a;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.erd-svg__open {
		font-size: 11px;
		font-weight: 700;
		fill: #18181b;
	}

	.erd-svg__field-flag {
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.05em;
	}

	.erd-svg__field-name {
		font-size: 12px;
		font-weight: 500;
		fill: #18181b;
	}

	.erd-svg__field-name--key {
		font-weight: 700;
		text-decoration: underline;
	}

	.erd-svg__field-type {
		font-size: 11px;
		fill: #71717a;
		font-family: var(--font-mono);
	}

	.erd-svg__relation-label {
		font-size: 10px;
		font-weight: 700;
		fill: #334155;
	}

	@media (max-width: 900px) {
		.erd-svg {
			height: 680px;
		}

		.erd-container {
			min-height: 680px;
		}

		.erd-controls,
		.erd-hint {
			position: static;
			margin: var(--space-3);
		}
	}
</style>
