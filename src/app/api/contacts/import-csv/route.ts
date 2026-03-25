import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Domains to flag as disposable / role-based
const ROLE_PREFIXES = ['info', 'admin', 'contact', 'hello', 'support', 'sales', 'noreply', 'no-reply', 'mailer', 'team']
const DISPOSABLE_DOMAINS = ['mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email', 'yopmail.com']

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const parseRow = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"' && !inQuotes) { inQuotes = true; continue }
      if (ch === '"' && inQuotes) { inQuotes = false; continue }
      if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue }
      current += ch
    }
    result.push(current.trim())
    return result
  }
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const rows = lines.slice(1).map(parseRow)
  return { headers, rows }
}

function findColumn(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.indexOf(c)
    if (idx !== -1) return idx
  }
  return -1
}

function validateEmail(email: string): { valid: boolean; reason?: string } {
  const e = email.toLowerCase().trim()
  if (!e || !e.includes('@')) return { valid: false, reason: 'no_at_sign' }
  const [local, domain] = e.split('@')
  if (!local || !domain || !domain.includes('.')) return { valid: false, reason: 'malformed' }
  if (DISPOSABLE_DOMAINS.some(d => domain.endsWith(d))) return { valid: false, reason: 'disposable_domain' }
  if (ROLE_PREFIXES.some(p => local === p)) return { valid: false, reason: 'role_based' }
  if (e.length > 254) return { valid: false, reason: 'too_long' }
  return { valid: true }
}

export async function POST(req: Request) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const batchName = (formData.get('batch_name') as string | null) || `csv_import_${new Date().toISOString().slice(0, 10)}`
  const defaultSource = (formData.get('source') as string | null) || 'csv_import'

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!file.name.endsWith('.csv')) return NextResponse.json({ error: 'Only CSV files are supported' }, { status: 400 })

  const text = await file.text()
  const { headers, rows } = parseCSV(text)

  if (headers.length === 0) return NextResponse.json({ error: 'CSV appears empty or malformed' }, { status: 400 })

  // Map column positions
  const col = {
    email:        findColumn(headers, ['email', 'email_address', 'e-mail']),
    firstName:    findColumn(headers, ['first_name', 'firstname', 'fname', 'first']),
    lastName:     findColumn(headers, ['last_name', 'lastname', 'lname', 'last']),
    name:         findColumn(headers, ['name', 'full_name', 'contact_name', 'contact_person']),
    company:      findColumn(headers, ['company', 'company_name', 'business', 'business_name', 'organisation', 'organization']),
    phone:        findColumn(headers, ['phone', 'mobile', 'phone_number', 'contact_number', 'whatsapp']),
    source:       findColumn(headers, ['source', 'lead_source']),
    tags:         findColumn(headers, ['tags', 'tag']),
    city:         findColumn(headers, ['city', 'location']),
    volume:       findColumn(headers, ['volume', 'monthly_volume', 'shipment_volume']),
  }

  if (col.email === -1) {
    return NextResponse.json({ error: 'CSV must have an "email" column' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const stats = { total: rows.length, valid: 0, invalid: 0, duplicate_csv: 0, exists_crm: 0, created: 0, enrichment_queued: 0, errors: 0 }
  const invalidRows: { row: number; email: string; reason: string }[] = []
  const seenEmails = new Set<string>()

  // Parse & validate all rows
  interface ParsedRow {
    email: string
    contact_person: string
    company_name: string
    phone: string | null
    source: string
    tags: string[]
    city: string | null
    estimated_monthly_volume: string | null
    missingFields: string[]
  }
  const validRows: ParsedRow[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rawEmail = (col.email >= 0 ? r[col.email] : '') || ''
    const email = rawEmail.toLowerCase().trim()

    const validation = validateEmail(email)
    if (!validation.valid) {
      stats.invalid++
      invalidRows.push({ row: i + 2, email: rawEmail, reason: validation.reason || 'invalid' })
      continue
    }

    if (seenEmails.has(email)) {
      stats.duplicate_csv++
      continue
    }
    seenEmails.add(email)

    const firstName = col.firstName >= 0 ? r[col.firstName]?.trim() : ''
    const lastName  = col.lastName  >= 0 ? r[col.lastName]?.trim()  : ''
    const nameCol   = col.name >= 0 ? r[col.name]?.trim() : ''
    const contactPerson = [firstName, lastName].filter(Boolean).join(' ') || nameCol || ''
    const companyName   = (col.company >= 0 ? r[col.company]?.trim() : '') || contactPerson || ''
    const phone         = col.phone >= 0 ? r[col.phone]?.trim() || null : null
    const source        = col.source >= 0 ? r[col.source]?.trim() || defaultSource : defaultSource
    const tagsRaw       = col.tags >= 0 ? r[col.tags]?.trim() : ''
    const tags          = tagsRaw ? tagsRaw.split(/[,;|]/).map(t => t.trim()).filter(Boolean) : []
    const city          = col.city >= 0 ? r[col.city]?.trim() || null : null
    const volume        = col.volume >= 0 ? r[col.volume]?.trim() || null : null

    // Determine missing fields for enrichment queue
    const missingFields: string[] = []
    if (!contactPerson) missingFields.push('contact_person')
    if (!companyName)   missingFields.push('company_name')
    if (!phone)         missingFields.push('phone')

    validRows.push({ email, contact_person: contactPerson, company_name: companyName, phone, source, tags, city, estimated_monthly_volume: volume, missingFields })
    stats.valid++
  }

  if (validRows.length === 0) {
    return NextResponse.json({ ok: false, stats, invalid_rows: invalidRows.slice(0, 50), error: 'No valid rows to import' }, { status: 422 })
  }

  // Check for existing CRM contacts
  const emailList = validRows.map(r => r.email)
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('id, email, type, status, import_source')
    .in('email', emailList)

  const existingByEmail = new Map<string, { id: string; type: string; status: string; import_source: string | null }>()
  for (const c of existingContacts || []) {
    existingByEmail.set(c.email, c)
  }

  // Separate into new vs existing
  interface MatchedRow extends ParsedRow { crmMatch: 'active_customer' | 'lapsed' | 'warm_lead' | 'new_cold' | 'already_exists' }
  const toInsert: MatchedRow[] = []
  const alreadyExists: { email: string; status: string }[] = []

  for (const row of validRows) {
    const existing = existingByEmail.get(row.email)
    if (existing) {
      stats.exists_crm++
      // Still tag it with the campaign context
      alreadyExists.push({ email: row.email, status: existing.status })
      const segment: MatchedRow['crmMatch'] =
        existing.type === 'customer' && existing.status === 'won' ? 'lapsed' :
        existing.type === 'lead' ? 'warm_lead' : 'already_exists'
      toInsert.push({ ...row, crmMatch: segment })
    } else {
      toInsert.push({ ...row, crmMatch: 'new_cold' })
    }
  }

  // Insert new contacts and update tags on existing ones in batches
  const BATCH = 50
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH)

    const newContacts = slice
      .filter(r => r.crmMatch === 'new_cold')
      .map(r => ({
        type:                     'lead' as const,
        status:                   'new',
        company_name:             r.company_name || r.email,
        contact_person:           r.contact_person || r.email.split('@')[0],
        email:                    r.email,
        phone:                    r.phone,
        source:                   r.source as 'website',
        tags:                     [...r.tags, 'csv_import'],
        import_source:            'csv_import' as const,
        import_batch:             batchName,
        score:                    25,
        health_score:             25,
        shipment_corridors:       [],
        custom_fields:            { city: r.city, volume: r.estimated_monthly_volume },
        estimated_monthly_volume: r.estimated_monthly_volume,
        created_at:               new Date().toISOString(),
        updated_at:               new Date().toISOString(),
      }))

    if (newContacts.length > 0) {
      const { data: inserted, error } = await supabase.from('contacts').insert(newContacts).select('id, email')
      if (error) {
        stats.errors += newContacts.length
      } else {
        stats.created += (inserted || []).length

        // Enqueue contacts with missing fields for enrichment
        const toEnqueue = (inserted || []).map(ins => {
          const original = slice.find(s => s.email === ins.email)
          return original && original.missingFields.length > 0
            ? { contact_id: ins.id, import_batch: batchName, missing_fields: original.missingFields, status: 'pending' as const }
            : null
        }).filter(Boolean) as { contact_id: string; import_batch: string; missing_fields: string[]; status: 'pending' }[]

        if (toEnqueue.length > 0) {
          await supabase.from('enrichment_queue').upsert(toEnqueue, { onConflict: 'contact_id' })
          stats.enrichment_queued += toEnqueue.length
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    batch_name: batchName,
    stats,
    segments: {
      new_cold:      toInsert.filter(r => r.crmMatch === 'new_cold').length,
      warm_lead:     toInsert.filter(r => r.crmMatch === 'warm_lead').length,
      lapsed:        toInsert.filter(r => r.crmMatch === 'lapsed').length,
      already_active: alreadyExists.length,
    },
    invalid_rows: invalidRows.slice(0, 50),
  })
}
