import { OpenFeature, type Client } from '@openfeature/server-sdk';
import { createConfidenceServerProvider } from '@spotify-confidence/openfeature-server-provider-local';
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

@Service()
export class ConfidenceClient {
	private readonly flagsCache = new Map<string, CachedFlags>();

	private readonly clientSecret: string;

	private readonly enabled: boolean;

	private client: Client | null = null;

	private initializationPromise: Promise<void> | null = null;

	constructor(
		private readonly instanceSettings: InstanceSettings,
		private readonly globalConfig: GlobalConfig,
	) {
		const { confidenceConfig } = this.globalConfig.diagnostics;
		this.clientSecret = confidenceConfig.clientSecret;
		this.enabled = confidenceConfig.enabled;
	}

	isEnabled(): boolean {
		return this.enabled && !!this.clientSecret;
	}

	/**
	 * Initialize the OpenFeature provider with Confidence.
	 * This should be called once during application startup.
	 */
	private async initialize(): Promise<void> {
		if (this.client) return;

		if (this.initializationPromise) {
			return this.initializationPromise;
		}

		this.initializationPromise = (async () => {
			const provider = createConfidenceServerProvider({
				flagClientSecret: this.clientSecret,
				// Local WASM evaluation - no per-eval network calls
				// Provider periodically refreshes resolver state (default every 30s)
				initializeTimeout: 30_000,
				stateUpdateInterval: 30_000,
				flushInterval: 10_000,
			});

			await OpenFeature.setProviderAndWait(provider);
			this.client = OpenFeature.getClient();
		})();

		return this.initializationPromise;
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
			await this.initialize();

			if (!this.client) {
				return {};
			}

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
		if (!this.client) {
			return {};
		}

		// Create evaluation context with user attributes for targeting
		const evaluationContext = {
			targetingKey,
			...context,
		};

		// Get all flags using OpenFeature's getBooleanValue/getStringValue
		// Since we don't know the flag names in advance, we use a different approach:
		// The flags are evaluated server-side and the provider caches them locally
		// We need to evaluate each flag we care about individually

		// For now, return empty flags - the actual flag evaluation happens
		// when specific flags are requested via getBooleanValue/getStringValue
		// This is a placeholder that should be updated once we know the flag names

		const flags: FeatureFlags = {};

		// Example of how to evaluate specific flags:
		// const enabled = await this.client.getBooleanValue('my-flag.enabled', false, evaluationContext);
		// flags['my-flag'] = enabled;

		return flags;
	}

	/**
	 * Evaluate a boolean feature flag.
	 * Use dot notation for nested values: 'flag-name.enabled'
	 */
	async getBooleanFlag(
		flagKey: string,
		defaultValue: boolean,
		user: Pick<PublicUser, 'id' | 'createdAt'>,
	): Promise<boolean> {
		if (!this.isEnabled()) return defaultValue;

		try {
			await this.initialize();

			if (!this.client) return defaultValue;

			const { instanceId } = this.instanceSettings;

			const context = {
				targetingKey: [instanceId, user.id].join('#'),
				instance_id: instanceId,
				user_id: user.id,
				created_at_timestamp: user.createdAt.getTime().toString(),
			};

			return await this.client.getBooleanValue(flagKey, defaultValue, context);
		} catch (error) {
			console.error(`Failed to evaluate flag ${flagKey}:`, error);
			return defaultValue;
		}
	}

	/**
	 * Evaluate a string feature flag.
	 * Use dot notation for nested values: 'flag-name.variant'
	 */
	async getStringFlag(
		flagKey: string,
		defaultValue: string,
		user: Pick<PublicUser, 'id' | 'createdAt'>,
	): Promise<string> {
		if (!this.isEnabled()) return defaultValue;

		try {
			await this.initialize();

			if (!this.client) return defaultValue;

			const { instanceId } = this.instanceSettings;

			const context = {
				targetingKey: [instanceId, user.id].join('#'),
				instance_id: instanceId,
				user_id: user.id,
				created_at_timestamp: user.createdAt.getTime().toString(),
			};

			return await this.client.getStringValue(flagKey, defaultValue, context);
		} catch (error) {
			console.error(`Failed to evaluate flag ${flagKey}:`, error);
			return defaultValue;
		}
	}

	/**
	 * Get detailed evaluation information for debugging.
	 */
	async getFlagDetails(
		flagKey: string,
		defaultValue: boolean,
		user: Pick<PublicUser, 'id' | 'createdAt'>,
	): Promise<{
		value: boolean;
		reason?: string;
		errorCode?: string;
		errorMessage?: string;
	}> {
		if (!this.isEnabled()) {
			return { value: defaultValue, reason: 'DISABLED' };
		}

		try {
			await this.initialize();

			if (!this.client) {
				return { value: defaultValue, reason: 'NOT_READY' };
			}

			const { instanceId } = this.instanceSettings;

			const context = {
				targetingKey: [instanceId, user.id].join('#'),
				instance_id: instanceId,
				user_id: user.id,
				created_at_timestamp: user.createdAt.getTime().toString(),
			};

			const details = await this.client.getBooleanDetails(flagKey, defaultValue, context);

			return {
				value: details.value,
				reason: details.reason,
				errorCode: details.errorCode,
				errorMessage: details.errorMessage,
			};
		} catch (error) {
			return {
				value: defaultValue,
				reason: 'ERROR',
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}
	}

	clearCache(): void {
		this.flagsCache.clear();
	}

	/**
	 * Cleanup resources on shutdown.
	 * Flushes any pending evaluation logs to the backend.
	 */
	async shutdown(): Promise<void> {
		await OpenFeature.close();
		this.client = null;
		this.initializationPromise = null;
	}
}
