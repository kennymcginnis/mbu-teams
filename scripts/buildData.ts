/**
 * Script to parse all Chester FC CSV spreadsheets and output a single
 * consolidated TypeScript data file at src/playerData.ts
 *
 * Run: npx tsx scripts/buildData.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ASSETS = join(__dirname, '..', 'src', 'assets')

// ─── CSV Parser (handles quoted fields with commas/embedded quotes) ──────────

function parseCSV(text: string): string[][] {
	const rows: string[][] = []
	let currentRow: string[] = []
	let field = ''
	let inQuotes = false

	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		const next = text[i + 1]

		if (inQuotes) {
			if (ch === '"') {
				if (next === '"') {
					field += '"'
					i++
				} else {
					inQuotes = false
				}
			} else {
				field += ch
			}
		} else {
			if (ch === '"') {
				inQuotes = true
			} else if (ch === ',') {
				currentRow.push(field)
				field = ''
			} else if (ch === '\n' || (ch === '\r' && next === '\n')) {
				currentRow.push(field)
				field = ''
				rows.push(currentRow)
				currentRow = []
				if (ch === '\r') i++
			} else if (ch === '\r') {
				currentRow.push(field)
				field = ''
				rows.push(currentRow)
				currentRow = []
			} else {
				field += ch
			}
		}
	}
	if (field || currentRow.length > 0) {
		currentRow.push(field)
		rows.push(currentRow)
	}
	return rows
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface PlayerRecord {
	name: string
	nickname: string
	pos: string
	pa: string
	team: string
	age?: string
	measurements: Record<string, string> // date -> CA value string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function isFullDate(s: string): boolean {
	return DATE_RE.test(s.trim())
}

function normalizeDate(s: string): string {
	const t = s.trim()
	// "2024-05" -> "2024-05-01"
	if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`
	return t
}

function isEmptyRow(row: string[]): boolean {
	return row.every(cell => cell.trim() === '')
}

function isPlayerRow(row: string[], nameIdx: number, posIdx: number): boolean {
	const name = row[nameIdx]?.trim()
	if (!name) return false
	// Must have at least a name and something else that looks like player data
	const pos = row[posIdx]?.trim()
	return !!pos || row.some((c, i) => i > posIdx && c.trim() !== '')
}

// Section header detection
const SECTION_HEADERS = [
	"Chester FC Men's Team Loans",
	"Chester FC Men's Team",
	'Chester FC U18',
	"Chester FC Men's Extended Universe",
	"Chester FC Men's Old Friends",
	"Chester FC Women's Extended Universe",
	"Chester FC Women's Old Friends",
	"Chester FC Women's Team",
	'Known Saltney Players',
	'League Two Legends',
	'Book Chapter',
	'Legends',
]

function detectSection(row: string[]): string | null {
	const first = row[0]?.trim()
	if (!first) return null
	for (const header of SECTION_HEADERS) {
		if (first.startsWith(header)) return first
	}
	return null
}

// ─── Parse "Early" Format (ca 24-25, ca 25-26) ─────────────────────────────

function parseEarlyFormat(csv: string, season: string): PlayerRecord[] {
	const rows = parseCSV(csv)
	if (rows.length < 2) return []

	const header = rows[0]
	// Date columns start at index 4
	const dateCols: { idx: number; date: string }[] = []
	for (let i = 4; i < header.length; i++) {
		const val = header[i]?.trim()
		if (val && /^\d{4}/.test(val)) {
			dateCols.push({ idx: i, date: normalizeDate(val) })
		}
	}

	const players: PlayerRecord[] = []
	let team = `Men's First Team`
	let skipSection = false

	for (let i = 1; i < rows.length; i++) {
		const row = rows[i]
		if (isEmptyRow(row)) {
			skipSection = false
			continue
		}

		const first = row[0]?.trim()
		// Skip metadata
		if (first === 'Book Chapter' || first === 'Legends') {
			skipSection = true
			continue
		}
		if (skipSection) continue

		// Check for section-like markers
		if (first && !row[2]?.trim() && !row[3]?.trim()) {
			// Might be a label row like "Transfer Out"
			continue
		}

		const name = first
		if (!name) continue

		const nickname = row[1]?.trim() || ''
		const pos = row[2]?.trim() || ''
		const pa = row[3]?.trim() || ''

		if (!pos) continue // Skip rows without position

		const measurements: Record<string, string> = {}
		for (const dc of dateCols) {
			const v = row[dc.idx]?.trim()
			if (v && v !== '') {
				measurements[dc.date] = v
			}
		}

		// Only include if they have at least some data
		if (Object.keys(measurements).length === 0 && !pa) continue

		players.push({ name, nickname, pos, pa, team, measurements })
	}

	return players
}

// ─── Parse "Late" Format (ca 26-27, 27-28, 28-29, wsl) ─────────────────────

function parseLateFormat(csv: string, defaultTeam: string): PlayerRecord[] {
	const rows = parseCSV(csv)
	if (rows.length < 4) return []

	// Find the date row: a row where many cells match YYYY-MM-DD
	let dateRowIdx = -1
	let dateColStart = -1
	for (let r = 0; r < Math.min(10, rows.length); r++) {
		let dateCount = 0
		let firstDateCol = -1
		for (let c = 0; c < rows[r].length; c++) {
			if (isFullDate(rows[r][c])) {
				dateCount++
				if (firstDateCol === -1) firstDateCol = c
			}
		}
		if (dateCount >= 3) {
			dateRowIdx = r
			dateColStart = firstDateCol
			break
		}
	}

	if (dateRowIdx === -1) return []

	// Build date column map
	const dateRow = rows[dateRowIdx]
	const dateCols: { idx: number; date: string }[] = []
	for (let c = dateColStart; c < dateRow.length; c++) {
		const d = dateRow[c]?.trim()
		if (isFullDate(d)) {
			dateCols.push({ idx: c, date: d })
		}
	}

	// Find column header row (should be dateRowIdx - 1 typically)
	const headerRowIdx = dateRowIdx - 1

	// Determine Name column index: look for "Name" in the header row
	const headerRow = rows[headerRowIdx]
	let nameIdx = 0 // default
	let posIdx = 1
	let ageIdx = 2
	let currentIdx = 3
	let paIdx = 5

	for (let c = 0; c < Math.min(10, headerRow?.length ?? 0); c++) {
		const h = headerRow[c]?.trim().toLowerCase()
		if (h === 'name' && c < 3) {
			nameIdx = c
			break
		}
	}

	// For these formats, the columns are typically:
	// Name(0), Pos(1), Age(2), Current(3), Weeks Since(4), PA(5), ...
	// But 27-28 has an extra "Gains" column: Name(0), Pos(1), Age(2), Current(3), Weeks Since(4), PA(5), Gains(6), Extra Info(7)

	// Detect PA column by looking for "PA" header
	for (let c = 0; c < Math.min(10, headerRow?.length ?? 0); c++) {
		const h = headerRow[c]?.trim()
		if (h === 'PA') {
			paIdx = c
			break
		}
		if (h === 'Pos') posIdx = c
		if (h === 'Age') ageIdx = c
		if (h === 'Current') currentIdx = c
	}

	const players: PlayerRecord[] = []
	let team = defaultTeam
	const dataStartRow = dateRowIdx + 1

	// Also check for sections with their own date rows (loans sections sometimes reuse the same date row)
	for (let i = dataStartRow; i < rows.length; i++) {
		const row = rows[i]
		if (isEmptyRow(row)) continue

		// Check for section headers
		const section = detectSection(row)
		if (section) {
			if (section.includes('Loans')) {
				team = `Men's Loans`
			} else if (section.includes('U18') || section.includes('Youth Cup')) {
				team = `Men's U18`
			} else if (section.includes('Extended Universe')) {
				if (section.includes('Women')) {
					team = `Women's Extended Universe`
				} else {
					team = `Men's Extended Universe`
				}
			} else if (section.includes('Old Friends')) {
				if (section.includes('Women')) {
					team = `Women's Alumni`
				} else {
					team = `Men's Alumni`
				}
			} else if (section.includes('Saltney')) {
				team = `Saltney Town`
			} else if (section.includes('League Two')) {
				team = `League Two Legends`
			} else if (section.includes('Women')) {
				team = `Women's First Team`
			} else if (section.includes("Men's Team")) {
				team = defaultTeam
			}
			continue
		}

		// Skip rows that look like metadata/averages
		const firstCell = row[nameIdx]?.trim()
		if (!firstCell) continue
		if (firstCell.startsWith('"Team Average"') || firstCell.startsWith('Team Average')) continue
		if (firstCell === 'Name' || firstCell === 'name') continue // sub-header row
		if (firstCell.startsWith('Book Chapter')) continue

		// Check if this looks like a player row
		const pos = row[posIdx]?.trim() || ''
		const paVal = row[paIdx]?.trim() || ''

		// Must have a position or PA to be a valid player
		if (!pos && !paVal) continue

		// Skip known non-player values in the name
		if (firstCell === 'MAX BEST' && pos === 'OMNI') {
			// Include MAX BEST as a reference player
		}

		const name = firstCell
		const age = row[ageIdx]?.trim() || ''
		const currentCA = row[currentIdx]?.trim() || ''
		const pa = paVal

		const measurements: Record<string, string> = {}

		// Try to get a "current" measurement from the Current column
		// We'll use the date from row 0 of the CSV if available
		for (const dc of dateCols) {
			const v = row[dc.idx]?.trim()
			if (v && v !== '') {
				measurements[dc.date] = v
			}
		}

		// Only include players with some data
		if (Object.keys(measurements).length === 0 && !currentCA && !pa) continue

		// If we have a currentCA but no measurements, still include the player
		players.push({
			name,
			nickname: '', // Later formats don't have a separate nickname column
			pos,
			pa,
			team,
			age,
			measurements,
		})
	}

	return players
}

// ─── Consolidation ──────────────────────────────────────────────────────────

function normalizePlayerName(name: string): string {
	// Remove quoted nicknames: Steve "Sticky" Icke -> Steve Icke
	// Remove nickname patterns: "Owen ""Rainman"" Travis" -> Owen Travis
	let n = name
		.replace(/""/g, '"')
		.replace(/"([^"]+)"/g, '') // remove quoted nicknames
		.replace(/\s+/g, ' ')
		.trim()
	// Also handle patterns like: Calabash "Bark" Barkley
	n = n.replace(/ "[\w\s]+" /g, ' ').trim()
	return n
}

function makeKey(name: string): string {
	return normalizePlayerName(name)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
}

interface ConsolidatedPlayer {
	name: string
	nickname: string
	pos: string
	pa: string
	team: string
	age: string
	measurements: Record<string, string>
}

function consolidate(allRecords: PlayerRecord[]): ConsolidatedPlayer[] {
	const playerMap = new Map<string, ConsolidatedPlayer>()

	for (const rec of allRecords) {
		const key = makeKey(rec.name)
		if (!key) continue

		const existing = playerMap.get(key)
		if (existing) {
			// Merge measurements (later data overwrites)
			for (const [date, val] of Object.entries(rec.measurements)) {
				existing.measurements[date] = val
			}
			// Update metadata if newer data has it
			if (rec.pos && rec.pos !== existing.pos) existing.pos = rec.pos
			if (rec.pa && rec.pa !== existing.pa) existing.pa = rec.pa
			if (rec.team) existing.team = rec.team
			if (rec.age) existing.age = rec.age
			if (rec.nickname) existing.nickname = rec.nickname
		} else {
			playerMap.set(key, {
				name: rec.name,
				nickname: rec.nickname,
				pos: rec.pos,
				pa: rec.pa,
				team: rec.team,
				age: rec.age || '',
				measurements: { ...rec.measurements },
			})
		}
	}

	return Array.from(playerMap.values())
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
	const allRecords: PlayerRecord[] = []

	// Parse early format CSVs
	const ca2425 = readFileSync(join(ASSETS, 'ca 24-25.csv'), 'utf-8')
	allRecords.push(...parseEarlyFormat(ca2425, '24-25'))

	const ca2526 = readFileSync(join(ASSETS, 'ca 25-26.csv'), 'utf-8')
	allRecords.push(...parseEarlyFormat(ca2526, '25-26'))

	// Parse late format CSVs
	const ca2627 = readFileSync(join(ASSETS, 'ca 26-27.csv'), 'utf-8')
	allRecords.push(...parseLateFormat(ca2627, `Men's First Team`))

	const ca2728 = readFileSync(join(ASSETS, 'ca 27-28.csv'), 'utf-8')
	allRecords.push(...parseLateFormat(ca2728, `Men's First Team`))

	const ca2829 = readFileSync(join(ASSETS, 'ca 28-29.csv'), 'utf-8')
	allRecords.push(...parseLateFormat(ca2829, `Men's First Team`))

	const wsl2728 = readFileSync(join(ASSETS, 'wsl 27-28.csv'), 'utf-8')
	allRecords.push(...parseLateFormat(wsl2728, `Women's First Team`))

	const wsl2829 = readFileSync(join(ASSETS, 'wsl 28-29.csv'), 'utf-8')
	allRecords.push(...parseLateFormat(wsl2829, `Women's First Team`))

	// Consolidate
	const players = consolidate(allRecords)

	// Collect all unique dates
	const dateSet = new Set<string>()
	for (const p of players) {
		for (const d of Object.keys(p.measurements)) {
			dateSet.add(d)
		}
	}
	const allDates = Array.from(dateSet).sort()

	// Sort players by team then name
	const teamOrder = [
		`Men's First Team`,
		`Men's Loans`,
		`Men's U18`,
		`Women's First Team`,
		`Saltney Town`,
		`Men's Extended Universe`,
		`Men's Alumni`,
		`Women's Extended Universe`,
		`Women's Alumni`,
		`League Two Legends`,
	]

	players.sort((a, b) => {
		const aTeam = teamOrder.indexOf(a.team)
		const bTeam = teamOrder.indexOf(b.team)
		const aIdx = aTeam === -1 ? 999 : aTeam
		const bIdx = bTeam === -1 ? 999 : bTeam
		if (aIdx !== bIdx) return aIdx - bIdx
		return a.name.localeCompare(b.name)
	})

	// Generate TypeScript output
	let output = `// Auto-generated by scripts/buildData.ts — do not edit manually\n\n`
	output += `export interface Player {\n`
	output += `  id: number\n`
	output += `  name: string\n`
	output += `  nickname: string\n`
	output += `  pos: string\n`
	output += `  pa: string\n`
	output += `  team: string\n`
	output += `  age: string\n`
	output += `  [date: string]: string | number | undefined\n`
	output += `}\n\n`

	output += `export const dates: string[] = ${JSON.stringify(allDates, null, 2)}\n\n`

	output += `export const players: Player[] = [\n`
	for (let i = 0; i < players.length; i++) {
		const p = players[i]
		const row: Record<string, string | number> = {
			id: i,
			name: p.name,
			nickname: p.nickname,
			pos: p.pos,
			pa: p.pa,
			team: p.team,
			age: p.age,
		}
		// Add measurements
		for (const [date, val] of Object.entries(p.measurements)) {
			row[date] = val
		}
		output += `  ${JSON.stringify(row)},\n`
	}
	output += `]\n`

	const outPath = join(__dirname, '..', 'src', 'playerData.ts')
	writeFileSync(outPath, output, 'utf-8')
	console.log(`✅ Generated ${outPath}`)
	console.log(`   ${players.length} players, ${allDates.length} date columns`)
}

main()
