import type { ExpoConfig } from 'expo/config';

// Keys come from mobile/.env (not committed). Without GOOGLE_MAPS_IOS_KEY the map falls back to Apple Maps.
const googleMapsKey = process.env.GOOGLE_MAPS_IOS_KEY ?? '';

const config: ExpoConfig = {
  name: 'TrailAI',
  slug: 'trailai',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'trailai',
  userInterfaceStyle: 'automatic', // Settings → Appearance overrides it at runtime (Night by default)
  ios: {
    // Icon Composer bundle: iOS 26+ renders the mark as Liquid Glass, with dark and tinted variants.
    icon: './assets/app.icon',
    bundleIdentifier: 'hk.comp4431.trailai',
    supportsTablet: false,
    infoPlist: {
      // The backend runs on the laptop (localhost in the simulator, hotspot IP on a phone) over plain HTTP/WS.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true },
      NSLocalNetworkUsageDescription: 'TrailAI connects to its planning server on your local network.',
    },
  },
  android: {
    package: 'hk.comp4431.trailai',
    predictiveBackGestureEnabled: false,
  },
  web: { output: 'static', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#0E110F', image: './assets/images/splash-icon.png', imageWidth: 120 }],
    ['react-native-maps', { iosGoogleMapsApiKey: googleMapsKey }],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Allow TrailAI to use the microphone so you can speak your trip.',
        speechRecognitionPermission: 'Allow TrailAI to turn your speech into text.',
      },
    ],
    './plugins/withSceneLifecycle',
    // Build Expo modules from source. With SDK 57's precompiled XCFrameworks the simulator dev build died at native
    // startup in facebook::react::Props::Props() while ExpoModulesCore registered its views (a binary mismatch with
    // the React core it links on Xcode 27.2). Costs a few minutes on a clean build; see the Gotchas in CLAUDE.md.
    ['expo-build-properties', { ios: { usePrecompiledModules: false } }],
  ],
  extra: { hasGoogleMaps: googleMapsKey.length > 0 },
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
