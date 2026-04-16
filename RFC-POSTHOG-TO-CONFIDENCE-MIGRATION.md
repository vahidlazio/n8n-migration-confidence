**PostHog to Confidence Feature Flag Migration**
RFC Document

---

**Status:** In Progress
**Authors:** Platform Team
**Created:** April 16, 2025

---

**SUMMARY**

This RFC documents our approach to migrating n8n's feature flag infrastructure from PostHog to Confidence (Spotify's feature flagging platform). The migration covers flag definitions, targeting rules, and SDK integration across our codebase.

---

**BACKGROUND & MOTIVATION**

Why Migrate?

We are consolidating our feature flag infrastructure from PostHog to Confidence for the following reasons:

1. Unified Platform - Confidence provides a purpose-built experimentation platform with stronger statistical rigor
2. Better Targeting - More sophisticated targeting capabilities for enterprise use cases
3. Organizational Alignment - Standardizing on a single feature flag platform across teams

Current State

- ~X feature flags in PostHog (exact count TBD during migration)
- SDK usage across frontend (React) and backend (Node.js)
- Mixed flag types: simple toggles, rollouts, A/B experiments, and complex targeting rules

---

**MIGRATION APPROACH**

Guiding Principles

1. Automation First - Minimize manual work through tooling
2. Zero Downtime - No disruption to production feature flag resolution
3. Transparency - Clear categorization of what can/cannot be migrated
4. Clean Slate Opportunity - Use migration as a chance to clean up stale flags

Migration Tool

We've built an AI-assisted migration skill that leverages both PostHog and Confidence APIs to:
- Analyze all PostHog flags
- Categorize them by migration complexity
- Automatically migrate eligible flags
- Transform SDK code
- Generate PRs for review

---

**FLAG CATEGORIZATION**

Flags are categorized into three buckets based on migration feasibility:

✅ AUTOMATIC MIGRATION (Green)

Flags that can be migrated with no human intervention:

| Pattern | Description |
| --- | --- |
| 100% rollout + targeting rules | Full rollout with attribute-based targeting |
| 100% rollout, no rules | Simple on/off toggle |
| Override rules | Specific user/entity overrides |

These flags will be automatically created in Confidence with equivalent targeting rules.


⚠️ REQUIRES HUMAN DECISION (Yellow)

Flags that CAN be migrated, but require explicit decisions:

Active Experiments (A/B Tests)

| Concern | Impact |
| --- | --- |
| Must be stopped before migration | Cannot continue experiment mid-flight |
| No exposure data sharing | Users will be re-randomized |
| Results stay in PostHog | Historical data not transferred |

Decision needed: Stop experiment, decide winner, or restart fresh in Confidence.

Partial Rollouts (<100%)

| Concern | Impact |
| --- | --- |
| Different hashing algorithms | Different user cohorts |
| Same % ≠ same users | 50% in PostHog ≠ same 50% in Confidence |

Decision needed: Accept that the rollout effectively restarts with different users.


❌ CANNOT MIGRATE AUTOMATICALLY (Red)

Flags using PostHog features without Confidence equivalents:

| PostHog Feature | Status | Workaround |
| --- | --- | --- |
| Segments (reusable groups) | Not supported | Inline targeting rules |
| icontains operator | Not supported | Use case-sensitive equals |
| is_not_set operator | Not supported | Manual workaround |
| Complex regex patterns | Partial | Convert to starts_with/ends_with where possible |

Decision needed: Simplify targeting, recreate manually, or keep in PostHog temporarily.

---

**OPERATOR COMPATIBILITY MATRIX**

| PostHog | Confidence | Migration |
| --- | --- | --- |
| exact / is | equals | ✅ Automatic |
| is_not | not_equals | ✅ Automatic |
| regex: .*@domain\.com$ | ends_with | ✅ Automatic (converted) |
| regex: ^prefix-.* | starts_with | ✅ Automatic (converted) |
| gt, gte, lt, lte | Same | ✅ Automatic |
| Multiple AND conditions | Multi-attribute rule | ✅ Automatic |
| contains | starts_with/ends_with | ⚠️ Partial (depends on pattern) |
| icontains | None | ❌ Manual |
| is_not_set | None | ❌ Manual |

---

**SDK MIGRATION**

Code Transformation Examples

Boolean Check:

// Before (PostHog)
if (posthog.isFeatureEnabled('feature-x')) { ... }

// After (Confidence)
const { value } = useFlag('feature-x', false);
if (value) { ... }

Variant Check:

// Before (PostHog)
const variant = posthog.getFeatureFlag('experiment');
if (variant === 'treatment') { ... }

// After (Confidence)
const { value } = useFlag('experiment', 'control');
if (value === 'treatment') { ... }

---

**ENTITY MAPPING**

A critical decision point in the migration:

| PostHog | Question | Options |
| --- | --- | --- |
| distinct_id | What entity does this represent? | user_id (authenticated) or visitor_id (anonymous) |

We ask this for each migration run because it affects how users are bucketed into variants.

---

**STALE FLAG CLEANUP**

The migration is also an opportunity to clean up technical debt:

| Indicator | Classification | Action |
| --- | --- | --- |
| No rules defined | Likely unused | Archive |
| 0 resolves in 30+ days | Inactive | Archive |
| No code references | Dead code | Remove from codebase |
| Already archived | Clean up | Skip migration |

---

**MIGRATION WORKFLOW**

1. Preview - Generate migration report, review categorization
2. Decide - Handle yellow/red flags (stop experiments, simplify targeting)
3. Migrate Flags - Automated creation in Confidence
4. Verify - Test flag resolution in Confidence
5. Transform Code - Automated SDK code changes
6. Review - PR with all changes for team review
7. Deploy - Gradual rollout of Confidence SDK
8. Monitor - Verify behavior matches PostHog
9. Cleanup - Archive PostHog flags after validation period

---

**RISKS & MITIGATIONS**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Experiment disruption | Active experiments must stop | Coordinate with product before migration |
| Rollout cohort changes | Different users in partial rollouts | Communicate to stakeholders, accept or complete rollout first |
| Targeting gaps | Some rules can't be replicated | Document gaps, implement workarounds, or maintain dual-platform |
| SDK bugs | Behavioral differences | Comprehensive testing, staged rollout |

---

**TIMELINE**

| Phase | Duration | Activities |
| --- | --- | --- |
| Discovery | Week 1 | Run preview, catalog all flags, identify blockers |
| Decisions | Week 1-2 | Resolve yellow/red flags with stakeholders |
| Migration | Week 2-3 | Migrate flags, transform code, testing |
| Validation | Week 3-4 | Staged rollout, monitoring |
| Cleanup | Week 4+ | Archive PostHog flags, remove old SDK |

---

**OPEN QUESTIONS**

1. Dual-running period - How long should we keep PostHog active after migration?
2. Rollback plan - If issues found, how do we switch back to PostHog?
3. Monitoring - What metrics indicate successful migration?
4. Documentation - How do we update internal docs to reflect Confidence?

---

**TARGETING PAYLOAD FORMAT**

For complex targeting rules, the migration tool uses raw Targeting proto JSON format:

```json
{
  "criteria": {
    "ref-0": {
      "attribute": {
        "attributeName": "plan",
        "setRule": { "values": [{ "stringValue": "pro" }] }
      }
    },
    "ref-1": {
      "attribute": {
        "attributeName": "country",
        "setRule": { "values": [{ "stringValue": "US" }] }
      }
    }
  },
  "expression": {
    "and": {
      "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }]
    }
  }
}
```

Supported rules: `setRule` (equals/in), `rangeRule` (gt/gte/lt/lte), `startsWithRule`, `endsWithRule`
Expression operators: `and`, `or`, `not`, `ref`

If the payload is invalid, the error message includes full schema documentation with examples.

---

**DECISION LOG**

| Date | Decision | Rationale |
| --- | --- | --- |
| April 15, 2025 | Created automated migration skill | Reduce manual effort, ensure consistency |
| April 16, 2025 | Document RFC | Enable team visibility and feedback |
| April 16, 2025 | Simplified addTargetingRule to only accept targetingPayload | Give agent full control over complex expressions |
| April 16, 2025 | Moved schema docs to error messages | In-context help when parsing fails, reduces tool count |

---

**FEEDBACK REQUESTED**

Please comment on:
- Any flags that need special handling?
- Concerns about the categorization approach?
- Timeline feasibility?
- Missing risks or mitigations?
