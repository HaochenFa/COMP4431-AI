import type { ExpoConfig } from 'expo/config';

// Keys come from mobile/.env (not committed). Without GOOGLE_MAPS_IOS_KEY the map falls back to Apple Maps.
const googleMapsKey = process.env.GOOGLE_MAPS_IOS_KEY ?? '';

const config: ExpoConfig = {
  name: 'Trailhead',
  slug: 'trailhead',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'trailhead',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'hk.comp4431.trailhead',
    supportsTablet: false,
    infoPlist: {
      // The backend runs on the laptop (localhost in the simulator, hotspot IP on a phone) over plain HTTP/WS.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true },
      NSLocalNetworkUsageDescription: 'Trailhead connects to its planning server on your local network.',
    },
  },
  android: {
    package: 'hk.comp4431.trailhead',
    predictiveBackGestureEnabled: false,
  },
  web: { output: 'static', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#14261f', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    ['react-native-maps', { iosGoogleMapsApiKey: googleMapsKey }],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Allow Trailhead to use the microphone so you can speak your trip.',
        speechRecognitionPermission: 'Allow Trailhead to turn your speech into text.',
      },
    ],
  ],
  extra: { hasGoogleMaps: googleMapsKey.length > 0 },
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
