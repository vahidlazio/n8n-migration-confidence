---
description: Migrate feature flags from PostHog to Confidence. Use when user wants to migrate flags, transform SDK code, or test migration between platforms.
---

# PostHog to Confidence Migration

Analyze and migrate feature flags from PostHog to Confidence, with codebase scanning and migration planning.

## Prerequisites

Ensure both MCP servers are installed and authenticated:

### PostHog MCP

```bash
npx @posthog/wizard@latest mcp add
```

### Konfidens MCP

```bash
claude mcp add konfidens --transport sse https://mcp.confidence.dev/mcp/flags
```

### Verify Installation

```bash
claude mcp list
```

## Commands

- `/n8n:migrate-posthog preview` - Analyze flags and produce migration report
- `/n8n:migrate-posthog flags` - Migrate eligible flags automatically
- `/n8n:migrate-posthog code` - Transform SDK code in codebase (offers to create PR)
- `/n8n:migrate-posthog full` - Flags + code transformation + PR creation

## Migration Categories

Flags are categorized into **three buckets**:

### 1. CAN BE MIGRATED AUTOMATICALLY ✅

Flags that can be moved to Confidence as-is:

| Criteria | Confidence Resource |
|----------|---------------------|
| 100% rollout + targeting rules | Flag with targeting rules |
| 100% rollout, no rules (simple toggle) | Flag with default rule |
| Override rules (specific user/entity) | Flag with override rules |

### 2. REQUIRES HUMAN INTERVENTION ⚠️

Flags that CAN be migrated but require stopping/restarting:

#### Experiments (A/B Tests)

| Issue | Impact |
|-------|--------|
| Must be **stopped** before migration | Cannot continue mid-experiment |
| No shared exposure data | Users re-randomized in Confidence |
| Results not transferable | Historical data stays in PostHog |

**Action required:** Stop experiment in PostHog, decide winner, then create new experiment in Confidence if needed.

#### Rollouts (Partial %)

| Issue | Impact |
|-------|--------|
| Must be **stopped and restarted** | Cannot continue seamlessly |
| Different hashing/salt | Different users in rollout |
| Same % ≠ same cohort | 50% in PostHog ≠ same 50% in Confidence |

**Action required:** User must accept that rollout restarts with different user cohort.

### 3. CANNOT BE FULLY MIGRATED ❌

Flags with features that have no Confidence equivalent:

| PostHog Feature | Confidence Status | Resolution |
|-----------------|-------------------|------------|
| Segments (reusable groups) | Not supported | Inline targeting rules |
| `icontains` operator | Not supported | Use `equals` (case-sensitive) |
| `is_not_set` operator | Not supported | Manual workaround |
| Group-level flags | Partial support | Pass group as context |

**Action required:** Human decision to recreate similar logic or discard.

### Supported Conversions ✅

These PostHog patterns CAN be migrated with automatic conversion:

| PostHog Pattern | Confidence Equivalent | Example |
|-----------------|----------------------|---------|
| `regex` ending with domain | `ends_with` | `.*@spotify\.com$` → `ends_with "@spotify.com"` |
| `regex` starting with prefix | `starts_with` | `^test-.*` → `starts_with "test-"` |
| Multiple AND conditions | Multi-attribute rule | `country=US AND plan=premium AND age>=21` → single rule with 3 conditions |
| `contains` substring | `starts_with` or `ends_with` | Depending on pattern position |

## Migration Flow

### 1. Analyze Flags (Preview)

```
PostHog MCP: feature-flag-get-all
```

For each flag, analyze:
- Rollout percentage (100% = can migrate, <100% = rollout)
- Number of variants (>2 = experiment)
- Targeting rules complexity
- Operator compatibility
- Usage/resolve data (stale detection)

### 2. Scan Codebase

Search the repository for PostHog SDK usage:

```
Grep: posthog.isFeatureEnabled|posthog.getFeatureFlag|useFeatureFlagEnabled
```

Map each flag to:
- Files that reference it
- Usage patterns (boolean check, variant switch, payload access)

### 3. Generate Migration Report

Output a **dashboard-style report**:

```
═══════════════════════════════════════════════════════════════
                    POSTHOG → CONFIDENCE MIGRATION REPORT
                    Repository: my-app
═══════════════════════════════════════════════════════════════

✅ CAN MIGRATE AUTOMATICALLY (3 flags)
───────────────────────────────────────────────────────────────
| Flag                  | Rules                | Code Refs    |
|-----------------------|----------------------|--------------|
| show-new-checkout     | country in [US,UK]   | 2 files      |
| enable-dark-mode      | plan = "premium"     | 5 files      |
| beta-features         | email ends @test.com | 1 file       |

⚠️ REQUIRES INTERVENTION (2 flags)
───────────────────────────────────────────────────────────────
| Flag                  | Type     | Issue                     |
|-----------------------|----------|---------------------------|
| pricing-experiment    | A/B Test | Must stop, no shared data |
| gradual-rollout       | Rollout  | 25% - different cohort    |

❌ CANNOT MIGRATE (1 flag)
───────────────────────────────────────────────────────────────
| Flag                  | Blocking Feature     | Suggestion   |
|-----------------------|----------------------|--------------|
| complex-targeting     | regex + icontains    | Simplify     |

🧹 STALE FLAGS (cleanup candidates)
───────────────────────────────────────────────────────────────
| Flag                  | Issue                | Last Resolve |
|-----------------------|----------------------|--------------|
| old-feature           | No rules defined     | 90 days ago  |
| unused-test           | 0 resolves           | Never        |

═══════════════════════════════════════════════════════════════
SUMMARY: 3 auto-migrate | 2 intervention | 1 blocked | 2 stale
═══════════════════════════════════════════════════════════════
```

### 4. Migrate Eligible Flags

**BEFORE STARTING MIGRATION, ASK THE USER:**

> "PostHog uses `distinct_id` for user bucketing. In Confidence, which entity should this map to?
> - `user_id` - for authenticated/logged-in users
> - `visitor_id` - for anonymous sessions/visitors
>
> This affects how users are assigned to flag variants."

Use the user's choice as the **allocation entity** for all targeting rules.

---

For each flag in "CAN MIGRATE AUTOMATICALLY":

1. **Check if flag already exists in Confidence**
   ```
   Konfidens MCP: listFlags (state: "ALL")
   ```
   - If flag exists and is **ARCHIVED**: unarchive it first, then update rules
   - If flag exists and is **ACTIVE**: update rules only
   - If flag doesn't exist: create new flag

2. **Check context schema compatibility**
   ```
   Konfidens MCP: getContextSchema
   ```

3. **Add missing context fields** (if user approves)
   ```
   Konfidens MCP: addContextField
   ```

4. **Create or update flag**
   - **New flag or existing active flag:**
     ```
     Konfidens MCP: createFlag
     ```
     Note: `createFlag` will update the flag if it already exists and enable it for the specified client.

   - **Existing archived flag:**
     ```
     Konfidens MCP: unarchiveFlag (restore the flag to active state)
     Konfidens MCP: createFlag (to update and enable for client)
     ```

5. **Add targeting rules**

   For flags **with** targeting conditions:
   ```
   Konfidens MCP: addTargetingRule
   ```

   For flags **without** targeting (100% rollout to everyone):
   ```
   Konfidens MCP: addTargetingRule
     attribute: "<chosen_entity>"  # user_id or visitor_id (from user's choice)
     operator: "not_in"
     value: "[]"
     variantName: "enabled"
     rolloutPercentage: "100"
   ```

   The `<entity> not_in []` pattern matches all users (since no one is in an empty set), creating a 100% rollout rule. Use the entity chosen by the user in step 4.

   **Operator Conversions:**

   When adding targeting rules, automatically convert PostHog operators:

   | PostHog | Confidence | Conversion Logic |
   |---------|------------|------------------|
   | `regex: .*@domain\.com$` | `ends_with: "@domain.com"` | Extract suffix after `.*` |
   | `regex: ^prefix-.*` | `starts_with: "prefix-"` | Extract prefix before `.*` |
   | Multiple properties in one group | Single rule with multiple conditions | Combine as AND conditions |

   **Multi-condition AND example:**
   ```
   PostHog: country=US AND plan=premium AND age>=21

   Konfidens MCP: addTargetingRule
     conditions:
       - attribute: "country", operator: "equals", value: "US"
       - attribute: "plan", operator: "equals", value: "premium"
       - attribute: "age", operator: "gte", value: "21"
     variantName: "enabled"
     rolloutPercentage: "100"
   ```

6. **Verify resolution**
   ```
   Konfidens MCP: resolveFlag
   ```

#### Handling Archived Flags

When a flag already exists in Confidence but is archived:

1. **Detect archived flags** - Use `listFlags` with `state: "ALL"` to find archived flags
2. **Unarchive the flag** - Use `unarchiveFlag` to restore it to active state
   ```
   Konfidens MCP: unarchiveFlag
   ```
3. **Update flag** - Use `createFlag` to update schema/variants and enable for client
4. **Apply new rules** - Add targeting rules from PostHog configuration
5. **Verify** - Test resolution to confirm correct behavior

This allows fully automated re-migration of flags that were previously migrated and then archived.

### 5. Transform SDK Code

For each flag reference in codebase, transform:

```typescript
// PostHog
if (posthog.isFeatureEnabled('my-flag')) { ... }

// Confidence
const { value } = useFlag('my-flag', false);
if (value) { ... }
```

### 6. Create Pull Request

After code transformation is complete, create a PR for review:

1. **Create a feature branch**
   ```bash
   git checkout -b feat/migrate-posthog-to-confidence
   ```

2. **Stage and commit changes**
   ```bash
   git add .
   git commit -m "feat: migrate feature flags from PostHog to Confidence

   - Replace PostHog SDK calls with Confidence SDK
   - Update flag references to use new API
   - Remove PostHog SDK dependency (if fully migrated)

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

3. **Create PR using the n8n:create-pr skill**
   ```
   /n8n:create-pr
   ```

   Or manually with gh CLI:
   ```bash
   gh pr create --title "feat: migrate feature flags from PostHog to Confidence" --body "$(cat <<'EOF'
   ## Summary
   - Migrated feature flag SDK from PostHog to Confidence
   - Updated X flag references across Y files
   - Flags migrated: [list migrated flags]

   ## Test plan
   - [ ] Verify flag resolution works in development
   - [ ] Test each migrated flag returns expected values
   - [ ] Confirm no PostHog SDK calls remain (if full migration)

   ## Migration notes
   - PostHog flags have been recreated in Confidence
   - Rollouts/experiments may have different user cohorts

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

4. **Link to migration tracking**
   - Reference the Linear ticket if applicable
   - Add links to Confidence dashboard for migrated flags

## Stale Flag Detection

Identify flags that are cleanup candidates:

| Indicator | Classification |
|-----------|----------------|
| No rules defined | Likely unused |
| 0 resolves in 30+ days | Inactive |
| No code references | Dead code |
| Archived in PostHog | Should archive in Confidence |

Position migration as **"migration + spring cleaning"** opportunity.

## Operator Compatibility

| PostHog Operator | Confidence Operator | Notes |
|------------------|---------------------|-------|
| `exact` / `is` | `equals` | ✅ Direct |
| `is_not` | `not_in` | ✅ Direct |
| `contains` | `starts_with`/`ends_with` | ⚠️ Convert based on pattern |
| `icontains` | ❌ None | Case-insensitive not supported |
| `regex` (suffix) | `ends_with` | ✅ `.*@domain\.com$` → `ends_with "@domain.com"` |
| `regex` (prefix) | `starts_with` | ✅ `^prefix-.*` → `starts_with "prefix-"` |
| `gt`, `gte`, `lt`, `lte` | `gt`, `gte`, `lt`, `lte` | ✅ Direct |
| `is_set` | `not_in` with empty | ⚠️ Workaround |
| `is_not_set` | ❌ None | Not directly supported |
| Multiple AND conditions | Multi-attribute rule | ✅ Fully supported |

## Entity Mapping

| PostHog Property | Confidence Attribute | Notes |
|------------------|---------------------|-------|
| `distinct_id` | `user_id` or `visitor_id` | **ASK USER BEFORE MIGRATION** |
| `$user_id` | `user_id` | Direct |
| `email` | `email` | Must match exactly |
| Group properties | Context attributes | Flatten structure |

**CRITICAL:**
- Always ask the user which entity to use for `distinct_id` mapping BEFORE starting migration
- `user_id` = authenticated users (has login, account)
- `visitor_id` = anonymous sessions (no login required)
- Never assume - the choice affects how users are bucketed into variants

## PostHog MCP Tools

| Tool | Description |
|------|-------------|
| `feature-flag-get-all` | List all feature flags |
| `feature-flag-get-definition` | Get detailed flag definition |

## Confidence MCP Tools Reference

### Client Management

| Tool | Parameters | Description |
|------|------------|-------------|
| `listClients` | `pageToken?` | List available SDK clients (iOS, Android, Backend, etc.) |
| `createClient` | `displayName`, `clientType` (Backend/Frontend) | Create a new SDK client |
| `getClientSecret` | `clientName`, `credentialId?` | Get client secret for SDK authentication |

### Context Schema

| Tool | Parameters | Description |
|------|------------|-------------|
| `getContextSchema` | `clientName` | Get available targeting fields (user_id, country, plan, etc.) |
| `addContextField` | `fieldName`, `fieldType`, `displayName?`, `isEntity?`, `entityReference?`, `clientNames?` | Add entity/attribute to context schema |

### Flag Management

| Tool | Parameters | Description |
|------|------------|-------------|
| `listFlags` | `state?` (ACTIVE/ARCHIVED/ALL), `owner?`, `query?`, `filter?` | List flags with filtering |
| `getFlag` | `flagName`, `summary?` (false for detailed rules) | Get flag details |
| `createFlag` | `flagName`, `clientName`, `description?`, `schemaObject?`, `variants?` | Create or update a flag |
| `addFlagVariant` | `flagName`, `variantName`, `value` (JSON) | Add variant to existing flag |
| `addFlagToClient` | `flagName`, `clientName` | Enable flag for a client |
| `removeFlagFromClient` | `flagName`, `clientName` | Disable flag for a client |
| `updateFlagSchema` | `flagName`, `schemaObject` | Update flag schema |
| `archiveFlag` | `flagName` | Archive a flag (stops resolution) |
| `unarchiveFlag` | `flagName` | Restore archived flag |

### Targeting Rules

| Tool | Parameters | Description |
|------|------------|-------------|
| `addTargetingRule` | `flagName`, `attribute`, `operator`, `value`, `variantName`, `rolloutPercentage?` | Add segment-based targeting |
| `addOverrideRule` | `flagName`, `entity`, `entityValue`, `variantName` | Force variant for specific entity |

**Supported operators for `addTargetingRule`:**
- `equals` - Exact match
- `in` - Set membership (value as JSON array)
- `not_in` - Set exclusion (value as JSON array)
- `gt`, `gte`, `lt`, `lte` - Numeric comparisons
- `starts_with`, `does_not_start_with` - String prefix
- `ends_with`, `does_not_end_with` - String suffix

### Testing

| Tool | Parameters | Description |
|------|------------|-------------|
| `resolveFlag` | `flagName`, `clientName`, `entity`, `entityValue` | Test flag resolution with detailed explanation |
| `analyzeFlagUsage` | `clientName` | Find unused/fully-rolled-out flags for cleanup |

## Confidence SDK Integration

**IMPORTANT:** Before implementing SDK integration, consult the Confidence docs MCP for up-to-date integration patterns.

### 1. Query Docs MCP for Integration Guide

Determine the target platform/framework from the codebase, then query docs:

```
Confidence Docs MCP: Search for relevant SDK documentation

For Node.js backend:
  - Search: "Node.js SDK" or "OpenFeature provider"
  
For React frontend:
  - Search: "React SDK" or "React hooks"
  
For Vue frontend:
  - Search: "JavaScript SDK" (Vue uses the JS SDK directly)
  
For REST API (custom implementation):
  - Search: "REST API" or "Resolve API"
```

### 2. Docs MCP Available Queries

The `confidence-docs-mcp` server provides documentation search. Query it for:

| Platform | Search Terms |
|----------|--------------|
| Node.js (Express, n8n backend) | `node sdk`, `openfeature server provider` |
| React | `react sdk`, `react provider`, `useFlag` |
| Vue/Vanilla JS | `javascript sdk`, `browser sdk` |
| REST API | `resolve api`, `api reference` |
| Context Schema | `evaluation context`, `targeting` |

### 3. Integration Patterns

After querying docs, implement based on the codebase architecture:

**Server-side resolution** (recommended for SSR/security):
- Backend resolves flags, passes results to frontend
- Frontend receives pre-evaluated flag values
- Suitable for: n8n, Next.js SSR, sensitive flag values

**Client-side resolution** (simpler for SPAs):
- Frontend SDK evaluates flags directly
- Requires exposing client secret to browser
- Suitable for: Pure SPAs, public feature toggles

### 4. Common Integration Steps

1. **Install SDK** - Use package from docs
2. **Configure client** - Set region, client secret
3. **Set evaluation context** - targeting_key + attributes
4. **Resolve flags** - Use SDK's flag resolution method
5. **Handle caching** - Configure cache TTL appropriately

### n8n Architecture Reference

For n8n specifically, check existing implementation:

1. **Backend**: `packages/cli/src/confidence/index.ts`
   - Server-side resolution via REST API
   - Caching with TTL
   - Context: `instance_id`, `user_id`, `created_at_timestamp`

2. **Frontend**: `packages/frontend/editor-ui/src/app/stores/confidence.store.ts`
   - Receives pre-evaluated flags from backend
   - Mirrors PostHog store API for compatibility

3. **Config**: `packages/@n8n/config/src/configs/diagnostics.config.ts`
   ```bash
   N8N_CONFIDENCE_ENABLED=true
   N8N_CONFIDENCE_CLIENT_SECRET=<secret>
   N8N_CONFIDENCE_API_HOST=https://resolver.confidence.dev
   ```

## SDK Transformation Patterns

### Boolean Check

```typescript
// PostHog
if (posthog.isFeatureEnabled('feature')) { ... }

// Confidence
const { value } = useFlag('feature', false);
if (value) { ... }
```

### Variant Check

```typescript
// PostHog
const variant = posthog.getFeatureFlag('experiment');
if (variant === 'treatment') { ... }

// Confidence
const { value } = useFlag('experiment', 'control');
if (value === 'treatment') { ... }
```

### Payload Access

```typescript
// PostHog
const payload = posthog.getFeatureFlagPayload('config');
const color = payload?.color || 'blue';

// Confidence
const { value } = useFlag('config', { color: 'blue' });
const color = value.color;
```

## Troubleshooting

### Experiments Cannot Continue

Experiments MUST be stopped before migration. There is no way to continue an experiment across platforms because:
- Exposure data is not shared
- Users will be re-randomized
- Statistical significance resets

### Rollout Users Change

Even with same percentage, different users will be in the rollout because:
- Different hashing algorithms
- Different salt values
- User assignment is not transferable

### Complex Targeting Blocked

If targeting uses unsupported operators (e.g., `icontains`):
1. Convert to case-sensitive `equals` if acceptable
2. Use `ends_with` or `starts_with` for partial matching
3. Accept limitation and recreate manually
4. Keep flag in PostHog (dual-run temporarily)

**Note:** Most complex targeting IS supported:
- `regex` patterns → Convert to `starts_with`/`ends_with`
- Multiple AND conditions → Single rule with multiple attributes
- Numeric comparisons → Direct mapping (`gt`, `gte`, `lt`, `lte`)
