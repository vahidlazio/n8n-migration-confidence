import { GlobalConfig } from '@n8n/config';
import type { PublicUser } from '@n8n/db';
import { Service } from '@n8n/di';
import { InstanceSettings } from 'n8n-core';
import type { FeatureFlags } from 'n8n-workflow';

const FLAGS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedFlags {
	flags: FeatureFlags;
	expiresAt: number;
}

interface ConfidenceResolveResponse {
	resolvedFlags: Record<
		string,
		{
			variant: string;
			value: unknown;
			reason: string;
		}
	>;
}

@Service()
export class ConfidenceClient {
	private readonly flagsCache = new Map<string, CachedFlags>();

	private readonly clientSecret: string;

	private readonly apiHost: string;

	private readonly enabled: boolean;

	constructor(
		private readonly instanceSettings: InstanceSettings,
		private readonly globalConfig: GlobalConfig,
	) {
		const { confidenceConfig } = this.globalConfig.diagnostics;
		this.clientSecret = confidenceConfig.clientSecret;
		this.apiHost = confidenceConfig.apiHost;
		this.enabled = confidenceConfig.enabled;
	}

	isEnabled(): boolean {
		return this.enabled && !!this.clientSecret;
	}

	async getFeatureFlags(user: Pick<PublicUser, 'id' | 'createdAt'>): Promise<FeatureFlags> {
		if (!this.isEnabled()) return {};

		const { instanceId } = this.instanceSettings;
		const fullId = [instanceId, user.id].join('#');

		const cached = this.flagsCache.get(fullId);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.flags;
		}

		try {
			const flags = await this.resolveFlags(fullId, {
				instance_id: instanceId,
				user_id: user.id,
				created_at_timestamp: user.createdAt.getTime().toString(),
			});

			if (flags && Object.keys(flags).length > 0) {
				this.flagsCache.set(fullId, { flags, expiresAt: Date.now() + FLAGS_CACHE_TTL_MS });
			}

			return flags ?? {};
		} catch (error) {
			console.error('Failed to resolve Confidence flags:', error);
			return {};
		}
	}

	private async resolveFlags(
		targetingKey: string,
		context: Record<string, string>,
	): Promise<FeatureFlags> {
		const response = await fetch(`${this.apiHost}/v1/flags:resolve`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.clientSecret}`,
			},
			body: JSON.stringify({
				evaluationContext: {
					targeting_key: targetingKey,
					...context,
				},
				apply: true,
			}),
		});

		if (!response.ok) {
			throw new Error(`Confidence API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as ConfidenceResolveResponse;

		// Convert Confidence response to FeatureFlags format
		const flags: FeatureFlags = {};
		for (const [flagName, flagData] of Object.entries(data.resolvedFlags ?? {})) {
			// Extract just the flag key without the "flags/" prefix
			const key = flagName.replace(/^flags\//, '');

			// For boolean flags, use the variant name or value directly
			if (typeof flagData.value === 'boolean') {
				flags[key] = flagData.value;
			} else if (typeof flagData.value === 'object' && flagData.value !== null) {
				// For structured flags, check for 'enabled' field or use variant
				const valueObj = flagData.value as Record<string, unknown>;
				if ('enabled' in valueObj) {
					flags[key] = valueObj.enabled;
				} else {
					flags[key] = flagData.variant;
				}
			} else {
				// Use variant name for multivariate flags
				flags[key] = flagData.variant ?? flagData.value;
			}
		}

		return flags;
	}

	clearCache(): void {
		this.flagsCache.clear();
	}
}
