// Adopts the UIScene life cycle, which the iOS 27 SDK requires at launch
// ("UIScene life cycle is required for apps built with this SDK").
//
// expo@57 ships the runtime half (ExpoAppSceneDelegate, ExpoReactNativeFactoryProvider) but its
// template still generates the pre-scene AppDelegate. This plugin applies the same changes as the
// SDK 58 template: a scene manifest in Info.plist, and an AppDelegate that leaves creating the
// window and starting React Native to the scene delegate. Drop it after upgrading to SDK 58.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

// ExpoAppSceneDelegate is exported to Objective-C under this name, so no Swift file is needed.
const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';

const withSceneManifest = (config) =>
  withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return config;
  });

// Each edit must match the generated AppDelegate exactly; fail the prebuild loudly if the template changes.
function replaceOnce(src, pattern, replacement, what) {
  if (!pattern.test(src)) {
    throw new Error(`withSceneLifecycle: couldn't find ${what} in AppDelegate.swift`);
  }
  return src.replace(pattern, replacement);
}

const withSceneAppDelegate = (config) =>
  withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: expected a Swift AppDelegate');
    }
    let src = config.modResults.contents;
    if (src.includes('ExpoReactNativeFactoryProvider')) return config;

    // The scene delegate finds the factory (and hands back the window) through this protocol.
    src = replaceOnce(
      src,
      /class AppDelegate: ExpoAppDelegate \{/,
      'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {',
      'the AppDelegate declaration',
    );
    // The scene delegate creates the window and starts React Native; doing it here too would start it twice.
    src = replaceOnce(
      src,
      /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/,
      '    // The window is created and React Native is started by the scene delegate under the\n' +
        '    // scene-based life cycle (required by the iOS 27 SDK).\n',
      'the window setup',
    );
    // ExpoAppSceneDelegate already forwards URLs and user activities to RCTLinkingManager.
    src = replaceOnce(
      src,
      /\n  \/\/ Linking API\n[\s\S]*?\n  \/\/ Universal Links\n[\s\S]*?return super\.application\(application, continue: userActivity, restorationHandler: restorationHandler\) \|\| result\n  \}\n/,
      '',
      'the Linking and Universal Links overrides',
    );

    config.modResults.contents = src;
    return config;
  });

module.exports = (config) => withSceneAppDelegate(withSceneManifest(config));
