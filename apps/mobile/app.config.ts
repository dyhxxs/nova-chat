import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const allowCleartext = process.env.ALLOW_CLEARTEXT === 'true';
  const plugins = (config.plugins ?? []).filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== 'expo-build-properties';
  });
  const infoPlist = { ...(config.ios?.infoPlist ?? {}) };
  if (allowCleartext) {
    infoPlist.NSAppTransportSecurity = {
      ...((infoPlist.NSAppTransportSecurity as Record<string, unknown> | undefined) ?? {}),
      NSAllowsArbitraryLoads: true,
    };
  }
  return {
    ...(config as ExpoConfig),
    ios: config.ios ? { ...config.ios, infoPlist } : config.ios,
    plugins: [
      ...plugins,
      ['expo-build-properties', { android: { usesCleartextTraffic: allowCleartext } }],
    ],
  };
};
