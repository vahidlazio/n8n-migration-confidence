import type { Ref } from 'vue';
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useStorage } from '@/app/composables/useStorage';
import { useUsersStore } from '@/features/settings/users/users.store';
import { useRootStore } from '@n8n/stores/useRootStore';
import { useSettingsStore } from '@/app/stores/settings.store';
import type { FeatureFlags, IDataObject } from 'n8n-workflow';
import { EXPERIMENTS_TO_TRACK, LOCAL_STORAGE_EXPERIMENT_OVERRIDES } from '@/app/constants';
import { useDebounce } from '@/app/composables/useDebounce';
import { useTelemetry } from '@/app/composables/useTelemetry';

const EVENTS = {
	IS_PART_OF_EXPERIMENT: 'User is part of experiment',
};

export type ConfidenceStore = ReturnType<typeof useConfidence>;

export const useConfidence = defineStore('confidence', () => {
	const usersStore = useUsersStore();
	const settingsStore = useSettingsStore();
	const telemetry = useTelemetry();
	const rootStore = useRootStore();
	const { debounce } = useDebounce();

	const featureFlags: Ref<FeatureFlags | null> = ref(null);
	const trackedDemoExp: Ref<FeatureFlags> = ref({});

	const overrides: Ref<Record<string, string | boolean>> = ref({});

	const reset = () => {
		featureFlags.value = null;
		trackedDemoExp.value = {};
	};

	const getVariant = (experiment: keyof FeatureFlags): FeatureFlags[keyof FeatureFlags] => {
		return overrides.value[experiment] ?? featureFlags.value?.[experiment];
	};

	const isVariantEnabled = (experiment: string, variant: string) => {
		return getVariant(experiment) === variant;
	};

	/**
	 * Checks if the given feature flag is enabled. Should only be used for boolean flags
	 */
	const isFeatureEnabled = (experiment: keyof FeatureFlags) => {
		return getVariant(experiment) === true;
	};

	// Initialize overrides from localStorage (for testing)
	if (!window.featureFlags) {
		const cachedOverrides = useStorage(LOCAL_STORAGE_EXPERIMENT_OVERRIDES).value;
		if (cachedOverrides) {
			try {
				console.log('Overriding feature flags', cachedOverrides);
				const parsedOverrides = JSON.parse(cachedOverrides);
				if (typeof parsedOverrides === 'object') {
					overrides.value = JSON.parse(cachedOverrides);
				}
			} catch (e) {
				console.log('Could not override experiment', e);
			}
		}

		window.featureFlags = {
			override: (name: string, value: string | boolean) => {
				overrides.value[name] = value;
				try {
					useStorage(LOCAL_STORAGE_EXPERIMENT_OVERRIDES).value = JSON.stringify(overrides.value);
				} catch (e) {}
			},

			getVariant,
			getAll: () => featureFlags.value ?? {},
		};
	}

	const trackExperiment = (featFlags: FeatureFlags, name: string) => {
		const variant = featFlags[name];
		if (!variant || trackedDemoExp.value[name] === variant) {
			return;
		}

		telemetry.track(EVENTS.IS_PART_OF_EXPERIMENT, {
			name,
			variant,
		});

		trackedDemoExp.value[name] = variant;
	};

	const trackExperiments = (featFlags: FeatureFlags) => {
		EXPERIMENTS_TO_TRACK.forEach((name) => trackExperiment(featFlags, name));
	};
	const trackExperimentsDebounced = debounce(trackExperiments, {
		debounceTime: 2000,
	});

	const init = (evaluatedFeatureFlags?: FeatureFlags) => {
		const userId = usersStore.currentUserId;
		if (!userId) {
			return;
		}

		// Confidence flags are evaluated server-side and passed to the frontend
		// via the user session, similar to how PostHog works
		if (evaluatedFeatureFlags && Object.keys(evaluatedFeatureFlags).length) {
			featureFlags.value = evaluatedFeatureFlags;
			trackExperimentsDebounced(featureFlags.value);
		}
	};

	const setMetadata = (metadata: IDataObject, target: 'user' | 'events') => {
		// Confidence doesn't have client-side metadata setting like PostHog
		// This is a no-op for compatibility
		console.debug('Confidence: setMetadata called', { metadata, target });
	};

	const capture = (event: string, properties: IDataObject) => {
		// Confidence doesn't have client-side event capture like PostHog
		// Events should be sent via the telemetry service instead
		console.debug('Confidence: capture called', { event, properties });
	};

	return {
		init,
		isFeatureEnabled,
		isVariantEnabled,
		getVariant,
		reset,
		setMetadata,
		capture,
		overrides,
	};
});
