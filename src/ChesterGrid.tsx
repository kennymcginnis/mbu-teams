import { useCallback, useMemo, useRef, useState } from 'react'
import type { ColDef, GridReadyEvent, CellClassParams, RowClassParams } from 'ag-grid-community'
import { AllCommunityModule, themeAlpine, colorSchemeDark } from 'ag-grid-community'
import {
	ColumnMenuModule,
	ColumnsToolPanelModule,
	ContextMenuModule,
	RowGroupingModule,
	RowGroupingPanelModule,
	SetFilterModule,
	SideBarModule,
	StatusBarModule,
	CellSelectionModule,
	ClipboardModule,
} from 'ag-grid-enterprise'
import { AgGridReact } from 'ag-grid-react'

import { players, dates, type Player } from './playerData'

const modules = [
	AllCommunityModule,
	ColumnMenuModule,
	ColumnsToolPanelModule,
	ContextMenuModule,
	RowGroupingModule,
	RowGroupingPanelModule,
	SetFilterModule,
	SideBarModule,
	StatusBarModule,
	CellSelectionModule,
	ClipboardModule,
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseCA(value: unknown): number | null {
	if (value == null || value === '') return null
	const s = String(value).trim()
	if (/^\d+-\d+$/.test(s)) {
		const [a, b] = s.split('-').map(Number)
		return Math.round((a + b) / 2)
	}
	const stripped = s.replace(/[?~]/, '')
	const n = Number(stripped)
	return isNaN(n) ? null : n
}

function formatDate(dateStr: string): string {
	const d = new Date(dateStr + 'T00:00:00')
	return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Find the most recent CA value at or before a given date index */
function getEffectiveCA(player: Player, dateIndex: number): number | null {
	for (let i = dateIndex; i >= 0; i--) {
		const v = parseCA(player[dates[i]])
		if (v != null) return v
	}
	return null
}

/** Check if a player has any data at a specific date */
function hasDataAtDate(player: Player, dateIndex: number): boolean {
	const v = player[dates[dateIndex]]
	return v != null && v !== ''
}

// ─── Row data computation ───────────────────────────────────────────────────

type PlayerStatus = 'new' | 'gone' | 'active' | 'unchanged'

interface GridRow {
	id: number
	name: string
	nickname: string
	pos: string
	pa: string | number | null
	team: string
	prevCA: number | null
	currCA: number | null
	delta: number | null
	status: PlayerStatus
}

function computeRows(dateIndex: number): GridRow[] {
	const prevIndex = dateIndex - 1
	const rows: GridRow[] = []

	for (const player of players) {
		const hasAtCurr = hasDataAtDate(player, dateIndex)
		const hasAtPrev = prevIndex >= 0 && hasDataAtDate(player, prevIndex)

		// Get effective CA values (carry forward if no exact match)
		const currCA = getEffectiveCA(player, dateIndex)
		const prevCA = prevIndex >= 0 ? getEffectiveCA(player, prevIndex) : null

		// Determine status
		let status: PlayerStatus = 'active'
		if (hasAtCurr && !hasAtPrev) {
			status = 'new'
		} else if (!hasAtCurr && hasAtPrev) {
			status = 'gone'
		} else if (!hasAtCurr && !hasAtPrev) {
			// Player has no data at either date - only show if they have carry-forward
			if (currCA == null) continue
			status = 'unchanged'
		}

		// Compute delta: only if player has actual data at both dates
		let delta: number | null = null
		if (hasAtCurr && hasAtPrev && currCA != null && prevCA != null) {
			delta = currCA - prevCA
		}

		const paNum = parseCA(player.pa)

		rows.push({
			id: player.id,
			name: player.name,
			nickname: player.nickname,
			pos: player.pos,
			pa: paNum,
			team: player.team,
			prevCA,
			currCA,
			delta,
			status,
		})
	}

	return rows
}

// ─── Cell class helpers ─────────────────────────────────────────────────────

function caCellClass(params: CellClassParams): string | string[] {
	const n = params.value as number | null
	if (n == null) return ''
	if (n >= 140) return 'ca-elite'
	if (n >= 120) return 'ca-world-class'
	if (n >= 100) return 'ca-excellent'
	if (n >= 80) return 'ca-good'
	if (n >= 60) return 'ca-decent'
	if (n >= 40) return 'ca-developing'
	return 'ca-low'
}

function deltaCellClass(params: CellClassParams): string | string[] {
	const n = params.value as number | null
	if (n == null) return 'delta-none'
	if (n > 0) return 'delta-positive'
	if (n < 0) return 'delta-negative'
	return 'delta-zero'
}

function rowClass(params: RowClassParams<GridRow>): string | string[] {
	if (!params.data) return ''
	if (params.data.status === 'new') return 'row-new'
	if (params.data.status === 'gone') return 'row-gone'
	return ''
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ChesterGrid() {
	const gridRef = useRef<AgGridReact>(null)
	const [dateIndex, setDateIndex] = useState(dates.length - 1)
	const [darkMode, setDarkMode] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
	const [teamFilter, setTeamFilter] = useState<string | null>(null)

	const allRows = useMemo(() => computeRows(dateIndex), [dateIndex])

	const teams = useMemo(() => {
		const counts = new Map<string, number>()
		for (const r of allRows) {
			counts.set(r.team, (counts.get(r.team) || 0) + 1)
		}
		return Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([team, count]) => ({ team, count }))
	}, [allRows])

	const rowData = useMemo(() => {
		if (!teamFilter) return allRows
		return allRows.filter(r => r.team === teamFilter)
	}, [allRows, teamFilter])

	const prevDateLabel = dateIndex > 0 ? formatDate(dates[dateIndex - 1]) : ''
	const currDateLabel = formatDate(dates[dateIndex])

	const columnDefs = useMemo<ColDef[]>(
		() => [
			{
				field: 'team',
				headerName: 'Team',
				rowGroup: true,
				hide: true,
			},
			{
				field: 'status',
				headerName: '',
				width: 60,
				pinned: 'left',
				cellRenderer: (params: { value: PlayerStatus }) => {
					if (params.value === 'new') return '🆕'
					if (params.value === 'gone') return '👋'
					return ''
				},
				filter: 'agSetColumnFilter',
			},
			{
				field: 'name',
				headerName: 'Name',
				pinned: 'left',
				flex: 2,
				minWidth: 200,
				filter: 'agTextColumnFilter',
				cellClass: 'player-name-cell',
			},
			{
				field: 'nickname',
				headerName: 'Nickname',
				flex: 1,
				minWidth: 130,
				filter: 'agTextColumnFilter',
			},
			{
				field: 'pos',
				headerName: 'Pos',
				flex: 1,
				minWidth: 130,
				filter: 'agSetColumnFilter',
			},
			{
				field: 'pa',
				headerName: 'PA',
				flex: 1,
				minWidth: 80,
				filter: 'agNumberColumnFilter',
				cellClass: caCellClass,
			},
			{
				field: 'prevCA',
				headerName: `CA: ${prevDateLabel}`,
				flex: 1,
				minWidth: 100,
				filter: 'agNumberColumnFilter',
				cellClass: caCellClass,
			},
			{
				field: 'currCA',
				headerName: `CA: ${currDateLabel}`,
				flex: 1,
				minWidth: 100,
				filter: 'agNumberColumnFilter',
				cellClass: caCellClass,
				enableCellChangeFlash: true,
			},
			{
				field: 'delta',
				headerName: 'Δ: Delta',
				flex: 1,
				minWidth: 80,
				filter: 'agNumberColumnFilter',
				cellClass: deltaCellClass,
				valueFormatter: params => {
					if (params.value == null) return ''
					return params.value > 0 ? `+${params.value}` : String(params.value)
				},
				enableCellChangeFlash: true,
			},
		],
		[prevDateLabel, currDateLabel],
	)

	const defaultColDef = useMemo<ColDef>(
		() => ({
			minWidth: 50,
			sortable: true,
			resizable: true,
		}),
		[],
	)

	const autoGroupColumnDef = useMemo(
		() => ({
			headerName: 'Team',
			minWidth: 280,
			flex: 2,
			pinned: 'left' as const,
			cellRendererParams: { suppressCount: false },
		}),
		[],
	)

	const onGridReady = useCallback((event: GridReadyEvent) => {
		event.api.expandAll()
	}, [])

	const handlePrev = () => setDateIndex(i => Math.max(1, i - 1))
	const handleNext = () => setDateIndex(i => Math.min(dates.length - 1, i + 1))

	const currYear = dates[dateIndex]?.slice(0, 4)

	// Compute unique years and their first date index for quick-jump buttons
	const yearStarts = useMemo(() => {
		const map: { year: string; index: number }[] = []
		let lastYear = ''
		for (let i = 0; i < dates.length; i++) {
			const y = dates[i].slice(0, 4)
			if (y !== lastYear) {
				map.push({ year: y, index: i })
				lastYear = y
			}
		}
		return map
	}, [])

	// Scroll selected date into center of the strip
	const stripRef = useRef<HTMLDivElement>(null)
	const selectedRef = useRef<HTMLButtonElement>(null)

	const scrollToSelected = useCallback(() => {
		if (selectedRef.current && stripRef.current) {
			const strip = stripRef.current
			const el = selectedRef.current
			const scrollLeft = el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2
			strip.scrollTo({ left: scrollLeft, behavior: 'smooth' })
		}
	}, [])

	// Scroll to selected whenever dateIndex changes
	useMemo(() => {
		// Use setTimeout to wait for render
		setTimeout(scrollToSelected, 0)
	}, [dateIndex, scrollToSelected])

	const gridTheme = darkMode ? themeAlpine.withPart(colorSchemeDark) : themeAlpine

	return (
		<div className={`chester-grid-wrapper ${darkMode ? 'dark' : ''}`}>
			<header className="chester-header">
				<div className="header-row">
					<h1>Chester FC — Player CA Tracker</h1>
					<button className="theme-toggle" onClick={() => setDarkMode(d => !d)} title="Toggle dark mode">
						{darkMode ? '☀️' : '🌙'}
					</button>
				</div>
				<div className="calendar-strip-wrapper">
					<div className="year-buttons">
						{yearStarts.map(({ year, index }) => (
							<button
								key={year}
								className={`year-btn ${year === currYear ? 'year-btn-active' : ''}`}
								onClick={() => setDateIndex(Math.max(1, index))}
							>
								{year}
							</button>
						))}
					</div>
					<button className="cal-nav-btn" onClick={handlePrev} disabled={dateIndex <= 1}>
						‹
					</button>
					<div className="calendar-strip" ref={stripRef}>
						{dates.map((d, i) => {
							const dateObj = new Date(d + 'T00:00:00')
							const dayAbbr = dateObj.toLocaleDateString('en', { weekday: 'short' }).toUpperCase()
							const dayNum = dateObj.getDate()
							const monthAbbr = dateObj.toLocaleDateString('en', { month: 'short' }).toUpperCase()
							const year = d.slice(0, 4)
							const prevYear = i > 0 ? dates[i - 1].slice(0, 4) : null
							const showYearDivider = prevYear !== null && year !== prevYear
							const isSelected = i === dateIndex
							const isPast = i < dateIndex
							const dayOfWeek = dateObj.getDay()
							const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

							return (
								<>
									{showYearDivider && (
										<div key={`yr-${year}`} className="cal-year-divider">
											<span>{year}</span>
										</div>
									)}
									<button
										key={d}
										ref={isSelected ? selectedRef : undefined}
										className={`cal-day ${isSelected ? 'cal-day-selected' : ''} ${isPast ? 'cal-day-past' : ''} ${isWeekend ? 'cal-day-weekend' : ''}`}
										onClick={() => setDateIndex(i)}
									>
										<span className="cal-day-label">{dayAbbr}</span>
										<span className="cal-day-num">{dayNum}</span>
										<span className="cal-day-month">{monthAbbr}</span>
										<span className="cal-day-year">{year}</span>
									</button>
								</>
							)
						})}
					</div>
					<button className="cal-nav-btn" onClick={handleNext} disabled={dateIndex >= dates.length - 1}>
						›
					</button>
				</div>
				<div className="team-buttons">
					<button
						className={`team-btn ${teamFilter === null ? 'team-btn-active' : ''}`}
						onClick={() => setTeamFilter(null)}
					>
						All
					</button>
					{teams.map(({ team, count }) => (
						<button
							key={team}
							className={`team-btn ${teamFilter === team ? 'team-btn-active' : ''}`}
							onClick={() => setTeamFilter(team)}
						>
							{team} ({count})
						</button>
					))}
				</div>
			</header>
			<div className="chester-grid">
				<AgGridReact
					ref={gridRef}
					modules={modules}
					theme={gridTheme}
					columnDefs={columnDefs}
					rowData={rowData}
					defaultColDef={defaultColDef}
					autoGroupColumnDef={autoGroupColumnDef}
					groupDefaultExpanded={-1}
					animateRows={true}
					onGridReady={onGridReady}
					getRowId={params => String(params.data.id)}
					getRowClass={rowClass}
					statusBar={{
						statusPanels: [
							{ statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
							{ statusPanel: 'agAggregationComponent', align: 'right' },
						],
					}}
				/>
			</div>
		</div>
	)
}
