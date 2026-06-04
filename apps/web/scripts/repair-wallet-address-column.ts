import { config } from 'dotenv'
import postgres from 'postgres'

config({ path: '.env.local' })
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured')
}

const sql = postgres(databaseUrl, { max: 1 })

type ColumnRename = {
  from: string
  to: string
}

type TableRepair = {
  table: string
  columns: ColumnRename[]
}

type ColumnDefault = {
  column: string
  defaultSql: string
  backfillSql?: string
  notNull?: boolean
}

type ColumnInfo = {
  column_name: string
  column_default: string | null
  is_nullable: 'YES' | 'NO'
  is_identity: 'YES' | 'NO'
  generated: string
}

const commonTimestamps: ColumnRename[] = [
  { from: 'createdAt', to: 'created_at' },
  { from: 'updatedAt', to: 'updated_at' },
]

const repairs: TableRepair[] = [
  {
    table: 'users',
    columns: [
      { from: 'walletAddress', to: 'wallet_address' },
      ...commonTimestamps,
    ],
  },
  {
    table: 'api_proxies',
    columns: [
      { from: 'userId', to: 'user_id' },
      { from: 'targetUrl', to: 'target_url' },
      { from: 'encryptedHeaders', to: 'encrypted_headers' },
      { from: 'paymentAddress', to: 'payment_address' },
      { from: 'pricePerRequest', to: 'price_per_request' },
      { from: 'isPublic', to: 'is_public' },
      { from: 'httpMethod', to: 'http_method' },
      { from: 'requestBodyTemplate', to: 'request_body_template' },
      { from: 'queryParamsTemplate', to: 'query_params_template' },
      { from: 'variablesSchema', to: 'variables_schema' },
      { from: 'exampleResponse', to: 'example_response' },
      { from: 'contentType', to: 'content_type' },
      ...commonTimestamps,
    ],
  },
  {
    table: 'request_logs',
    columns: [
      { from: 'proxyId', to: 'proxy_id' },
      { from: 'requesterWallet', to: 'requester_wallet' },
    ],
  },
  {
    table: 'session_keys',
    columns: [
      { from: 'userId', to: 'user_id' },
      { from: 'sessionId', to: 'session_id' },
      { from: 'sessionKeyAddress', to: 'session_key_address' },
      { from: 'encryptedPrivateKey', to: 'encrypted_private_key' },
      { from: 'onChainParams', to: 'on_chain_params' },
      { from: 'allowedTargets', to: 'allowed_targets' },
      { from: 'allowedSelectors', to: 'allowed_selectors' },
      { from: 'validAfter', to: 'valid_after' },
      { from: 'validUntil', to: 'valid_until' },
      { from: 'approvedContracts', to: 'approved_contracts' },
      { from: 'oauthClientId', to: 'oauth_client_id' },
      { from: 'oauthGrantId', to: 'oauth_grant_id' },
      { from: 'isActive', to: 'is_active' },
      { from: 'revokedAt', to: 'revoked_at' },
      ...commonTimestamps,
    ],
  },
  {
    table: 'oauth_clients',
    columns: [
      { from: 'secretHash', to: 'secret_hash' },
      { from: 'logoUrl', to: 'logo_url' },
      { from: 'redirectUris', to: 'redirect_uris' },
      { from: 'allowedScopes', to: 'allowed_scopes' },
      { from: 'mcpSlug', to: 'mcp_slug' },
      { from: 'isActive', to: 'is_active' },
      ...commonTimestamps,
    ],
  },
  {
    table: 'oauth_auth_codes',
    columns: [
      { from: 'clientId', to: 'client_id' },
      { from: 'userId', to: 'user_id' },
      { from: 'requestedScopes', to: 'requested_scopes' },
      { from: 'approvedScopes', to: 'approved_scopes' },
      { from: 'sessionConfig', to: 'session_config' },
      { from: 'codeChallenge', to: 'code_challenge' },
      { from: 'codeChallengeMethod', to: 'code_challenge_method' },
      { from: 'redirectUri', to: 'redirect_uri' },
      { from: 'expiresAt', to: 'expires_at' },
      { from: 'usedAt', to: 'used_at' },
    ],
  },
  {
    table: 'oauth_access_tokens',
    columns: [
      { from: 'tokenHash', to: 'token_hash' },
      { from: 'clientId', to: 'client_id' },
      { from: 'userId', to: 'user_id' },
      { from: 'sessionKeyId', to: 'session_key_id' },
      { from: 'mcpSlug', to: 'mcp_slug' },
      { from: 'expiresAt', to: 'expires_at' },
      { from: 'revokedAt', to: 'revoked_at' },
      { from: 'createdAt', to: 'created_at' },
    ],
  },
  {
    table: 'mcp_servers',
    columns: [
      { from: 'userId', to: 'user_id' },
      { from: 'isPublic', to: 'is_public' },
      ...commonTimestamps,
    ],
  },
  {
    table: 'mcp_server_tools',
    columns: [
      { from: 'mcpServerId', to: 'mcp_server_id' },
      { from: 'apiProxyId', to: 'api_proxy_id' },
      { from: 'toolName', to: 'tool_name' },
      { from: 'toolDescription', to: 'tool_description' },
      { from: 'shortDescription', to: 'short_description' },
      { from: 'displayOrder', to: 'display_order' },
      { from: 'isEnabled', to: 'is_enabled' },
      { from: 'createdAt', to: 'created_at' },
    ],
  },
  {
    table: 'workflow_templates',
    columns: [
      { from: 'userId', to: 'user_id' },
      { from: 'inputSchema', to: 'input_schema' },
      { from: 'workflowDefinition', to: 'workflow_definition' },
      { from: 'outputSchema', to: 'output_schema' },
      { from: 'isPublic', to: 'is_public' },
      { from: 'isVerified', to: 'is_verified' },
      ...commonTimestamps,
    ],
  },
  {
    table: 'mcp_server_workflows',
    columns: [
      { from: 'mcpServerId', to: 'mcp_server_id' },
      { from: 'workflowId', to: 'workflow_id' },
      { from: 'toolName', to: 'tool_name' },
      { from: 'toolDescription', to: 'tool_description' },
      { from: 'displayOrder', to: 'display_order' },
      { from: 'isEnabled', to: 'is_enabled' },
      { from: 'createdAt', to: 'created_at' },
    ],
  },
]

const uuidIdTables = [
  'users',
  'api_proxies',
  'request_logs',
  'session_keys',
  'oauth_access_tokens',
  'mcp_servers',
  'mcp_server_tools',
  'workflow_templates',
  'mcp_server_workflows',
]

const defaultRepairs: Record<string, ColumnDefault[]> = {
  users: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
    { column: 'updated_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  api_proxies: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'is_public', defaultSql: 'false', backfillSql: 'false', notNull: true },
    { column: 'http_method', defaultSql: "'GET'", backfillSql: "'GET'", notNull: true },
    { column: 'tags', defaultSql: "'[]'::jsonb", backfillSql: "'[]'::jsonb" },
    { column: 'variables_schema', defaultSql: "'[]'::jsonb", backfillSql: "'[]'::jsonb" },
    { column: 'content_type', defaultSql: "'application/json'", backfillSql: "'application/json'" },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
    { column: 'updated_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  request_logs: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'timestamp', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  session_keys: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'scopes', defaultSql: "'[]'::jsonb", backfillSql: "'[]'::jsonb" },
    { column: 'allowed_targets', defaultSql: "'[]'::jsonb", backfillSql: "'[]'::jsonb", notNull: true },
    { column: 'allowed_selectors', defaultSql: "'[]'::jsonb", backfillSql: "'[]'::jsonb" },
    { column: 'approved_contracts', defaultSql: "'[]'::jsonb", backfillSql: "'[]'::jsonb" },
    { column: 'is_active', defaultSql: 'true', backfillSql: 'true', notNull: true },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
    { column: 'updated_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  oauth_clients: [
    { column: 'is_active', defaultSql: 'true', backfillSql: 'true', notNull: true },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
    { column: 'updated_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  oauth_auth_codes: [
    { column: 'code_challenge_method', defaultSql: "'S256'", backfillSql: "'S256'", notNull: true },
  ],
  oauth_access_tokens: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  mcp_servers: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'is_public', defaultSql: 'false', backfillSql: 'false', notNull: true },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
    { column: 'updated_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  mcp_server_tools: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'display_order', defaultSql: '0', backfillSql: '0', notNull: true },
    { column: 'is_enabled', defaultSql: 'true', backfillSql: 'true', notNull: true },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  workflow_templates: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'input_schema', defaultSql: "'[]'::jsonb", backfillSql: "'[]'::jsonb", notNull: true },
    { column: 'is_public', defaultSql: 'false', backfillSql: 'false', notNull: true },
    { column: 'is_verified', defaultSql: 'false', backfillSql: 'false', notNull: true },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
    { column: 'updated_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
  mcp_server_workflows: [
    { column: 'id', defaultSql: 'gen_random_uuid()', backfillSql: 'gen_random_uuid()', notNull: true },
    { column: 'display_order', defaultSql: '0', backfillSql: '0', notNull: true },
    { column: 'is_enabled', defaultSql: 'true', backfillSql: 'true', notNull: true },
    { column: 'created_at', defaultSql: 'now()', backfillSql: 'now()', notNull: true },
  ],
}

const expectedColumns: Record<string, string[]> = {
  users: ['id', 'wallet_address', 'created_at', 'updated_at'],
  api_proxies: [
    'id',
    'user_id',
    'slug',
    'name',
    'description',
    'target_url',
    'encrypted_headers',
    'payment_address',
    'price_per_request',
    'is_public',
    'category',
    'tags',
    'http_method',
    'request_body_template',
    'query_params_template',
    'variables_schema',
    'example_response',
    'content_type',
    'created_at',
    'updated_at',
  ],
  request_logs: ['id', 'proxy_id', 'requester_wallet', 'status', 'timestamp'],
  session_keys: [
    'id',
    'user_id',
    'session_id',
    'session_key_address',
    'encrypted_private_key',
    'scopes',
    'on_chain_params',
    'allowed_targets',
    'allowed_selectors',
    'valid_after',
    'valid_until',
    'approved_contracts',
    'oauth_client_id',
    'oauth_grant_id',
    'is_active',
    'revoked_at',
    'created_at',
    'updated_at',
  ],
  oauth_clients: [
    'id',
    'secret_hash',
    'name',
    'description',
    'logo_url',
    'redirect_uris',
    'allowed_scopes',
    'mcp_slug',
    'is_active',
    'created_at',
    'updated_at',
  ],
  oauth_auth_codes: [
    'code',
    'client_id',
    'user_id',
    'requested_scopes',
    'approved_scopes',
    'session_config',
    'code_challenge',
    'code_challenge_method',
    'redirect_uri',
    'expires_at',
    'used_at',
  ],
  oauth_access_tokens: [
    'id',
    'token_hash',
    'client_id',
    'user_id',
    'session_key_id',
    'scopes',
    'mcp_slug',
    'expires_at',
    'revoked_at',
    'created_at',
  ],
  mcp_servers: ['id', 'user_id', 'slug', 'name', 'description', 'is_public', 'created_at', 'updated_at'],
  mcp_server_tools: [
    'id',
    'mcp_server_id',
    'api_proxy_id',
    'tool_name',
    'tool_description',
    'short_description',
    'display_order',
    'is_enabled',
    'created_at',
  ],
  workflow_templates: [
    'id',
    'user_id',
    'slug',
    'name',
    'description',
    'input_schema',
    'workflow_definition',
    'output_schema',
    'is_public',
    'is_verified',
    'created_at',
    'updated_at',
  ],
  mcp_server_workflows: [
    'id',
    'mcp_server_id',
    'workflow_id',
    'tool_name',
    'tool_description',
    'display_order',
    'is_enabled',
    'created_at',
  ],
}

const appTables = Object.keys(expectedColumns)

async function main() {
  let renameCount = 0
  let defaultCount = 0
  let legacyColumnCount = 0

  try {
    const [connectionInfo] = await sql<{
      database_name: string
      user_name: string
      server_address: string | null
    }[]>`
      SELECT
        current_database() AS database_name,
        current_user AS user_name,
        inet_server_addr()::text AS server_address
    `

    console.log('Repairing database:', connectionInfo)

    await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`

    for (const repair of repairs) {
      renameCount += await repairTable(repair)
    }

    for (const table of uuidIdTables) {
      defaultCount += await ensurePrimaryUuidDefault(table)
    }

    for (const [table, columns] of Object.entries(defaultRepairs)) {
      defaultCount += await repairColumnDefaults(table, columns)
    }

    for (const table of appTables) {
      legacyColumnCount += await relaxBlockingLegacyColumns(table, expectedColumns[table])
    }

    await verifyUsersTable()

    console.log(`Schema repair complete. Renamed ${renameCount} column(s), repaired ${defaultCount} default/backfill rule(s), relaxed ${legacyColumnCount} legacy required column(s).`)
  } finally {
    await sql.end()
  }
}

async function relaxBlockingLegacyColumns(table: string, expected: string[]): Promise<number> {
  if (!await hasTable(table)) {
    return 0
  }

  const expectedSet = new Set(expected)
  const columns = await getColumnInfo(table)
  let relaxedCount = 0

  for (const column of columns) {
    if (
      expectedSet.has(column.column_name)
      || column.is_nullable === 'YES'
      || column.column_default
      || column.is_identity === 'YES'
      || column.generated !== 'NEVER'
    ) {
      continue
    }

    await sql`ALTER TABLE ${sql(table)} ALTER COLUMN ${sql(column.column_name)} DROP NOT NULL`
    relaxedCount += 1
    console.log(`${table}.${column.column_name}: dropped NOT NULL on legacy column not used by this app.`)
  }

  return relaxedCount
}

async function repairTable(repair: TableRepair): Promise<number> {
  const tableExists = await hasTable(repair.table)

  if (!tableExists) {
    console.log(`Skipping ${repair.table}; table does not exist.`)
    return 0
  }

  const columnNames = await getColumnNames(repair.table)
  let renameCount = 0

  for (const column of repair.columns) {
    if (columnNames.has(column.to)) {
      continue
    }

    if (!columnNames.has(column.from)) {
      continue
    }

    await sql`ALTER TABLE ${sql(repair.table)} RENAME COLUMN ${sql(column.from)} TO ${sql(column.to)}`
    columnNames.delete(column.from)
    columnNames.add(column.to)
    renameCount += 1
    console.log(`Renamed ${repair.table}."${column.from}" to ${repair.table}.${column.to}.`)
  }

  if (renameCount === 0) {
    console.log(`${repair.table}: no column repairs needed.`)
  }

  return renameCount
}

async function ensurePrimaryUuidDefault(table: string): Promise<number> {
  if (!await hasTable(table) || !await hasColumn(table, 'id')) {
    return 0
  }

  await sql`UPDATE ${sql(table)} SET ${sql('id')} = gen_random_uuid() WHERE ${sql('id')} IS NULL`
  await sql`ALTER TABLE ${sql(table)} ALTER COLUMN ${sql('id')} SET DEFAULT gen_random_uuid()`
  await sql`ALTER TABLE ${sql(table)} ALTER COLUMN ${sql('id')} SET NOT NULL`
  console.log(`${table}.id: ensured UUID default and NOT NULL.`)
  return 1
}

async function repairColumnDefaults(table: string, columns: ColumnDefault[]): Promise<number> {
  if (!await hasTable(table)) {
    return 0
  }

  const columnNames = await getColumnNames(table)
  let repairCount = 0

  for (const column of columns) {
    if (!columnNames.has(column.column)) {
      continue
    }

    if (column.backfillSql) {
      await sql.unsafe(
        `UPDATE "${table}" SET "${column.column}" = ${column.backfillSql} WHERE "${column.column}" IS NULL`
      )
    }

    await sql.unsafe(
      `ALTER TABLE "${table}" ALTER COLUMN "${column.column}" SET DEFAULT ${column.defaultSql}`
    )

    if (column.notNull) {
      await sql.unsafe(
        `ALTER TABLE "${table}" ALTER COLUMN "${column.column}" SET NOT NULL`
      )
    }

    repairCount += 1
    console.log(`${table}.${column.column}: ensured default${column.notNull ? ' and NOT NULL' : ''}.`)
  }

  return repairCount
}

async function hasTable(table: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${table}
    )
  `

  return rows[0]?.exists === true
}

async function getColumnNames(table: string): Promise<Set<string>> {
  const columns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
  `

  return new Set(columns.map((column) => column.column_name))
}

async function getColumnInfo(table: string): Promise<ColumnInfo[]> {
  return sql<ColumnInfo[]>`
    SELECT column_name, column_default, is_nullable, is_identity, is_generated AS generated
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
  `
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    )
  `

  return rows[0]?.exists === true
}

async function verifyUsersTable() {
  if (!await hasTable('users')) {
    throw new Error('users table does not exist after repair.')
  }

  const rows = await sql<{
    column_name: string
    column_default: string | null
    is_nullable: 'YES' | 'NO'
  }[]>`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND (
        column_name IN ('id', 'wallet_address', 'created_at', 'updated_at')
        OR is_nullable = 'NO'
      )
    ORDER BY column_name
  `

  console.table(rows)

  const idColumn = rows.find((row) => row.column_name === 'id')

  if (!idColumn?.column_default?.includes('gen_random_uuid')) {
    throw new Error('users.id still does not have DEFAULT gen_random_uuid().')
  }

  const expectedUserColumns = new Set(expectedColumns.users)
  const blockingLegacyColumns = rows.filter((row) =>
    !expectedUserColumns.has(row.column_name)
    && row.is_nullable === 'NO'
    && !row.column_default
  )

  if (blockingLegacyColumns.length > 0) {
    throw new Error(`users still has blocking legacy NOT NULL columns: ${blockingLegacyColumns.map((row) => row.column_name).join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
