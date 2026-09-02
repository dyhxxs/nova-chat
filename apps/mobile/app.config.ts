import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = (config.plugins ?? []).filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== 'expo-build-properties';
  });
  return {
    ...(config as ExpoConfig),
    plugins: [
      ...plugins,
      ['expo-build-properties', { android: { usesCleartextTraffic: process.env.ALLOW_CLEARTEXT === 'true' } }],
    ],
  };
};
