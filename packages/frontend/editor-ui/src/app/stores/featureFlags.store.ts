import { defineStore } from 'pinia';
import { computed } from 'vue';
import { usePostHog } from '@/app/stores/posthog.store';
import { useConfidence } from '@/app/stores/confidence.store';
import { useSettingsStore } from '@/app/stores/settings.store';
import type { FeatureFlags, IDataObject } from 'n8n-workflow';

export type FeatureFlagsStore = ReturnType<typeof useFeatureFlags>;

/**
 * Unified feature flags store that delegates to either PostHog or Confidence
 * based on the server configuration.
 *
 * This abstraction allows gradual migration from PostHog to Confidence
 * without changing consumer code.
 */
export const useFeatureFlags = defineStore('featureFlags', () => {
	const posthogStore = usePostHog();
	const confidenceStore = useConfidence();
	const settingsStore = useSettingsStore();

	/**
	 * Check if Confidence is enabled via server settings.
	 * When enabled, Confidence takes precedence over PostHog for feature flags.
	 */
	const useConfidenceProvider = computed(() => {
		return settingsStore.settings.confidence?.enabled ?? false;
	});

	const getVariant = (experiment: keyof FeatureFlags): FeatureFlags[keyof FeatureFlags] => {
		if (useConfidenceProvider.value) {
			return confidenceStore.getVariant(experiment);
		}
		return posthogStore.getVariant(experiment);
	};

	const isVariantEnabled = (experiment: string, variant: string): boolean => {
		if (useConfidenceProvider.value) {
			return confidenceStore.isVariantEnabled(experiment, variant);
		}
		return posthogStore.isVariantEnabled(experiment, variant);
	};

	const isFeatureEnabled = (experiment: keyof FeatureFlags): boolean => {
		if (useConfidenceProvider.value) {
			return confidenceStore.isFeatureEnabled(experiment);
		}
		return posthogStore.isFeatureEnabled(experiment);
	};

	const init = (evaluatedFeatureFlags?: FeatureFlags) => {
		// Initialize both stores - the active one based on config will be used
		posthogStore.init(evaluatedFeatureFlags);
		confidenceStore.init(evaluatedFeatureFlags);
	};

	const reset = () => {
		posthogStore.reset();
		confidenceStore.reset();
	};

	const setMetadata = (metadata: IDataObject, target: 'user' | 'events') => {
		if (useConfidenceProvider.value) {
			confidenceStore.setMetadata(metadata, target);
		} else {
			posthogStore.setMetadata(metadata, target);
		}
	};

	const capture = (event: string, properties: IDataObject) => {
		if (useConfidenceProvider.value) {
			confidenceStore.capture(event, properties);
		} else {
			posthogStore.capture(event, properties);
		}
	};

	const identify = () => {
		// PostHog has identify, Confidence doesn't need it (context is passed with each request)
		if (!useConfidenceProvider.value) {
			posthogStore.identify();
		}
	};

	const overrides = computed(() => {
		if (useConfidenceProvider.value) {
			return confidenceStore.overrides;
		}
		return posthogStore.overrides;
	});

	return {
		init,
		isFeatureEnabled,
		isVariantEnabled,
		getVariant,
		reset,
		identify,
		setMetadata,
		capture,
		overrides,
		useConfidenceProvider,
	};
});
